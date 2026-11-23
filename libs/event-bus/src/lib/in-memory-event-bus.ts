import { BusEvent } from './bus-event';
import { BusHandler, BusLogger, BusSubscription, EventBus } from './event-bus';
import { LocalEventDispatcher } from './local-event-dispatcher';

/**
 * Le bus dans la mémoire du processus : pour une API qui tourne sur une seule instance, les tests et le
 * développement. Un événement ne quitte pas le processus qui l'a publié.
 */
export class InMemoryEventBus extends EventBus {
  private readonly dispatcher: LocalEventDispatcher;

  constructor(logger?: BusLogger) {
    super();
    this.dispatcher = new LocalEventDispatcher(logger);
  }

  /** Le nombre d'abonnés (utile aux tests). */
  get subscriberCount(): number {
    return this.dispatcher.subscriberCount;
  }

  async publish(event: BusEvent): Promise<void> {
    this.dispatcher.dispatch(event);
  }

  subscribe(type: string, handler: BusHandler): BusSubscription {
    return this.dispatcher.subscribe(type, handler);
  }

  /** Attendre que chaque abonné ait traité ce qu'il a reçu. */
  idle(): Promise<void> {
    return this.dispatcher.idle();
  }
}
