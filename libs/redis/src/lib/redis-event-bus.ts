import type { BusEvent, BusHandler, BusLogger, BusSubscribeOptions, BusSubscription } from '@org/event-bus';
import { EventBus, EventBusClosedError, LocalEventDispatcher, parseBusEvent } from '@org/event-bus';
import type { RedisOptions } from 'ioredis';
import { Redis } from 'ioredis';

export type RedisEventBusOptions = {
  /** `redis://` ou `rediss://` (TLS), avec l'éventuel mot de passe. */
  url: string;
  /** Le canal des événements, partagé par les instances d'un même environnement. */
  channel: string;
  logger?: BusLogger;
  /** Le temps laissé à chaque tentative de connexion (5 s par défaut). */
  connectTimeoutMs?: number;
  /** Le temps laissé à Redis pour accepter un événement (2 s par défaut). */
  publishTimeoutMs?: number;
};

const consoleLogger: BusLogger = {
  error: (message, error) => console.error(message, error),
  info: (message) => console.info(message),
};

/**
 * Le bus entre plusieurs instances de l'API, par le pub/sub de Redis
 * ([ADR 0010](../../../../docs/adr/0010-runtime-des-workflows-et-bus-d-evenements.md)) : chaque instance
 * publie sur un même canal et y est abonnée.
 *
 * - Un abonné `one-instance` (une réaction du serveur) reçoit l'événement sur l'instance qui le publie, sans
 *   passer par Redis : la réaction ne se répète pas sur les autres instances, et ne dépend pas de Redis.
 * - Un abonné `every-instance` (un flux SSE) le reçoit de Redis, sur chaque instance, celle qui publie
 *   comprise : un seul chemin, donc ni doublon ni désordre.
 *
 * Au plus une fois : Redis ne garde rien. Un événement publié pendant que Redis est injoignable, ou pendant
 * qu'une instance s'y reconnecte, est perdu pour les abonnés `every-instance` ; une publication perdue avec
 * sa connexion n'est jamais rejouée, Redis a pu la recevoir.
 */
export class RedisEventBus extends EventBus {
  private readonly dispatcher: LocalEventDispatcher;
  private readonly lastErrors = new Map<Redis, unknown>();
  private started = false;
  private closed = false;

  private constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
    private readonly channel: string,
    private readonly logger: BusLogger,
  ) {
    super();
    this.dispatcher = new LocalEventDispatcher(logger);
    this.watch(publisher, 'publisher');
    this.watch(subscriber, 'subscriber');
    subscriber.on('message', (from: string, message: string) => this.receive(from, message));
  }

  /**
   * Se connecter à Redis et s'abonner au canal. Rejette, sans rien laisser ouvert, quand Redis ne répond
   * pas : le serveur ne démarre pas sur une adresse fausse. Une fois connecté, le bus se reconnecte seul.
   */
  static async connect(options: RedisEventBusOptions): Promise<RedisEventBus> {
    const common: RedisOptions = { lazyConnect: true, connectTimeout: options.connectTimeoutMs ?? 5_000 };
    const publisher = new Redis(options.url, {
      ...common,
      // Au plus une fois : une publication n'attend pas la reconnexion, et n'est jamais renvoyée.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      commandTimeout: options.publishTimeoutMs ?? 2_000,
    });
    // Après une coupure, l'abonnement au canal est rétabli (`autoResubscribe`, par défaut).
    const subscriber = new Redis(options.url, common);
    const bus = new RedisEventBus(publisher, subscriber, options.channel, options.logger ?? consoleLogger);

    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
      await subscriber.subscribe(options.channel);
    } catch (error) {
      publisher.disconnect();
      subscriber.disconnect();
      // « Connection is closed » ne dit rien : la dernière erreur de connexion dit pourquoi.
      const cause = bus.lastErrors.get(publisher) ?? bus.lastErrors.get(subscriber) ?? error;
      throw new Error(`Redis is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`, {
        cause,
      });
    }

    bus.started = true;
    return bus;
  }

  async publish(event: BusEvent): Promise<void> {
    if (this.closed) throw new EventBusClosedError();

    // Les réactions du serveur, ici seulement : c'est l'instance où le fait a eu lieu.
    this.dispatcher.dispatch(event, 'one-instance');
    // Les abonnés de chaque instance, celle-ci comprise, par Redis.
    await this.publisher.publish(this.channel, JSON.stringify(event));
  }

  subscribe(type: string, handler: BusHandler, options?: BusSubscribeOptions): BusSubscription {
    return this.dispatcher.subscribe(type, handler, options);
  }

  /** Attendre que les abonnés de cette instance aient traité ce qu'ils ont reçu (tests). */
  idle(): Promise<void> {
    return this.dispatcher.idle();
  }

  /** Ne plus rien recevoir, laisser les abonnés finir, puis fermer les connexions. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await quit(this.subscriber);
    await this.dispatcher.close();
    await quit(this.publisher);
  }

  private receive(channel: string, message: string): void {
    if (channel !== this.channel || this.closed) return;

    const event = parseBusEvent(message);
    if (!event) {
      this.logger.error(`Ignored a message on ${channel} that is not an event`);
      return;
    }

    this.dispatcher.dispatch(event, 'every-instance');
  }

  /**
   * Une coupure journalisée une fois, puis son rétablissement : ioredis réessaie sans fin, et signale une
   * erreur à chaque tentative.
   */
  private watch(client: Redis, name: string): void {
    let healthy = true;

    client.on('error', (error: unknown) => this.lastErrors.set(client, error));

    client.on('close', () => {
      if (!this.started || this.closed || !healthy) return;
      healthy = false;
      this.logger.error(`Redis ${name} connection lost; reconnecting`, this.lastErrors.get(client));
    });

    client.on('ready', () => {
      this.lastErrors.delete(client);
      if (!healthy) this.logger.info?.(`Redis ${name} connection restored`);
      healthy = true;
    });
  }
}

/** Fermer proprement une connexion prête ; couper celle qui ne l'est pas (rien n'attend sa reconnexion). */
async function quit(client: Redis): Promise<void> {
  if (client.status !== 'ready') {
    client.disconnect();
    return;
  }

  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
