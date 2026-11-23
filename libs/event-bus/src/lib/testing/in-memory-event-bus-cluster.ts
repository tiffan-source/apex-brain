import { BusEvent, parseBusEvent } from '../bus-event';
import {
  BusHandler,
  BusLogger,
  BusSubscribeOptions,
  BusSubscription,
  EventBus,
  EventBusClosedError,
} from '../event-bus';
import { LocalEventDispatcher } from '../local-event-dispatcher';

type Network = {
  broadcast(text: string): void;
  join(receive: (text: string) => void): () => void;
};

/**
 * Plusieurs instances de l'API dans un même processus, reliées comme par Redis (tests) : un événement publié
 * sur une instance va à ses abonnés `one-instance`, et aux abonnés `every-instance` de chaque instance,
 * celle-ci comprise, en copie JSON comme d'un bus distant. Rien ne se perd entre les instances.
 */
export class InMemoryEventBusCluster {
  private readonly receivers = new Set<(text: string) => void>();
  private readonly buses: InMemoryClusterBus[] = [];

  /** Le bus d'une instance de plus. */
  instance(logger?: BusLogger): InMemoryClusterBus {
    const bus = new InMemoryClusterBus(
      {
        broadcast: (text) => {
          for (const receive of this.receivers) receive(text);
        },
        join: (receive) => {
          this.receivers.add(receive);
          return () => this.receivers.delete(receive);
        },
      },
      logger,
    );
    this.buses.push(bus);
    return bus;
  }

  /** Attendre que les abonnés de chaque instance aient traité ce qu'ils ont reçu. */
  async idle(): Promise<void> {
    await Promise.all(this.buses.map((bus) => bus.idle()));
  }
}

/** Le bus d'une instance d'un `InMemoryEventBusCluster`. */
export class InMemoryClusterBus extends EventBus {
  private readonly dispatcher: LocalEventDispatcher;
  private readonly leave: () => void;
  private closed = false;

  constructor(
    private readonly network: Network,
    logger?: BusLogger,
  ) {
    super();
    this.dispatcher = new LocalEventDispatcher(logger);
    this.leave = network.join((text) => this.receive(text));
  }

  /** Le nombre d'abonnés de cette instance (utile aux tests). */
  get subscriberCount(): number {
    return this.dispatcher.subscriberCount;
  }

  async publish(event: BusEvent): Promise<void> {
    if (this.closed) throw new EventBusClosedError();
    this.dispatcher.dispatch(event, 'one-instance');
    this.network.broadcast(JSON.stringify(event));
  }

  subscribe(type: string, handler: BusHandler, options?: BusSubscribeOptions): BusSubscription {
    return this.dispatcher.subscribe(type, handler, options);
  }

  /** Attendre que les abonnés de cette instance aient traité ce qu'ils ont reçu. */
  idle(): Promise<void> {
    return this.dispatcher.idle();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.leave();
    await this.dispatcher.close();
  }

  private receive(text: string): void {
    const event = parseBusEvent(text);
    if (event) this.dispatcher.dispatch(event, 'every-instance');
  }
}
