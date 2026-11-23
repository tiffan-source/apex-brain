import { BusEvent } from './bus-event';
import { BusDelivery, BusHandler, BusLogger, BusSubscribeOptions, BusSubscription } from './event-bus';

type Subscriber = {
  type: string;
  delivery: BusDelivery;
  handler: BusHandler;
  /** Les livraisons de cet abonné, l'une après l'autre. */
  queue: Promise<void>;
  active: boolean;
};

const consoleLogger: BusLogger = {
  error: (message, error) => console.error(message, error),
};

/**
 * La livraison aux abonnés d'un processus, commune à tous les bus : une file par abonné (l'ordre est gardé,
 * un abonné lent ne retient pas les autres), toujours hors de la pile de celui qui publie, et une erreur
 * d'abonné journalisée sans jamais remonter.
 */
export class LocalEventDispatcher {
  private readonly subscribers = new Set<Subscriber>();
  private pending = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly logger: BusLogger = consoleLogger) {}

  /** Le nombre d'abonnés (utile aux tests). */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  subscribe(type: string, handler: BusHandler, options: BusSubscribeOptions = {}): BusSubscription {
    const subscriber: Subscriber = {
      type,
      delivery: options.delivery ?? 'one-instance',
      handler,
      queue: Promise.resolve(),
      active: true,
    };
    this.subscribers.add(subscriber);

    return {
      unsubscribe: () => {
        subscriber.active = false;
        this.subscribers.delete(subscriber);
      },
    };
  }

  /**
   * Remettre l'événement à chaque abonné concerné, après ceux qu'il a déjà reçus : tous, ou seulement ceux
   * d'un mode de livraison (un bus distant livre `one-instance` en publiant, `every-instance` en recevant).
   */
  dispatch(event: BusEvent, delivery?: BusDelivery): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.type !== '*' && subscriber.type !== event.type) continue;
      if (delivery && subscriber.delivery !== delivery) continue;

      this.pending += 1;
      subscriber.queue = subscriber.queue.then(async () => {
        try {
          if (subscriber.active) await subscriber.handler(event);
        } catch (error) {
          this.logger.error(`Event subscriber failed on ${event.type} (${event.id})`, error);
        } finally {
          this.settle();
        }
      });
    }
  }

  /** Attendre que chaque abonné ait traité ce qu'il a reçu (tests, arrêt). */
  idle(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Attendre les livraisons en cours, puis retirer tous les abonnés. */
  async close(): Promise<void> {
    await this.idle();
    for (const subscriber of this.subscribers) subscriber.active = false;
    this.subscribers.clear();
  }

  private settle(): void {
    this.pending -= 1;
    if (this.pending > 0) return;

    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
