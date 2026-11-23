import { BusEvent } from './bus-event';
import {
  BusHandler,
  BusLogger,
  BusSubscribeOptions,
  BusSubscription,
  EventBus,
  EventBusClosedError,
} from './event-bus';
import { LocalEventDispatcher } from './local-event-dispatcher';

/**
 * Le bus dans la mémoire du processus : pour une API qui tourne sur une seule instance, les tests et le
 * développement. Un événement ne quitte pas le processus qui l'a publié ; chaque abonné le reçoit, quel
 * que soit son mode de livraison (il n'y a qu'une instance).
 */
export class InMemoryEventBus extends EventBus {
  private readonly dispatcher: LocalEventDispatcher;
  private closed = false;

  constructor(logger?: BusLogger) {
    super();
    this.dispatcher = new LocalEventDispatcher(logger);
  }

  /** Le nombre d'abonnés (utile aux tests). */
  get subscriberCount(): number {
    return this.dispatcher.subscriberCount;
  }

  async publish(event: BusEvent): Promise<void> {
    if (this.closed) throw new EventBusClosedError();
    this.dispatcher.dispatch(event);
  }

  subscribe(type: string, handler: BusHandler, options?: BusSubscribeOptions): BusSubscription {
    return this.dispatcher.subscribe(type, handler, options);
  }

  /** Attendre que chaque abonné ait traité ce qu'il a reçu. */
  idle(): Promise<void> {
    return this.dispatcher.idle();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.dispatcher.close();
  }
}
