import type { BeforeApplicationShutdown, MessageEvent } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { AI_ASSISTANT_WORKFLOW, SendMessageToAIWorkflow } from '@org/ai-assistant';
import type { BusEvent } from '@org/event-bus';
import { EventBus } from '@org/event-bus';
import type { Subscriber } from 'rxjs';
import { Observable } from 'rxjs';
import { unwrap } from '../http/result';

/** Un commentaire régulier, pour que les proxys ne coupent pas une connexion restée silencieuse. */
const HEARTBEAT_MS = 25_000;

/** Ce qu'un client attend avant de se reconnecter, en millisecondes (champ `retry` du SSE). */
const RECONNECT_AFTER_MS = 3_000;

/**
 * Le flux SSE de l'assistant, pour la propriétaire d'un objectif (docs/adr/0010) : son état à l'ouverture,
 * puis les événements publics de son objectif, tels que le bus les transporte. Le bus garde les événements
 * internes et ceux des autres personnes ; le flux ne lit rien d'autre que le bus et l'état.
 */
@Injectable()
export class AssistantEventStream implements BeforeApplicationShutdown {
  private readonly active = new Set<Subscriber<MessageEvent>>();
  private closing = false;

  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(SendMessageToAIWorkflow) private readonly workflow: SendMessageToAIWorkflow,
  ) {}

  /**
   * À l'arrêt, avant que le serveur ne ferme ses connexions : les flux ouverts se terminent (le serveur
   * attendrait sinon que chaque client se déconnecte) ; le client se reconnecte, à une autre instance ou à
   * celle qui la remplace.
   */
  beforeApplicationShutdown(): void {
    this.closing = true;
    for (const subscriber of this.active) subscriber.complete();
  }

  /** Lève `CONVERSATION_NOT_FOUND` avant d'ouvrir le flux quand l'objectif n'est pas à elle. */
  async open(objectiveId: string, ownerId: string): Promise<Observable<MessageEvent>> {
    unwrap(await this.workflow.getState(objectiveId, ownerId));

    return new Observable<MessageEvent>((subscriber) => {
      // Le serveur s'arrête : rien à suivre ici.
      if (this.closing) return subscriber.complete();

      let started = false;
      const waiting: BusEvent[] = [];
      this.active.add(subscriber);

      // Abonné au bus avant de relire l'état : rien ne se perd entre les deux, au pire un état arrive deux fois.
      // Sur chaque instance : le workflow de l'objectif ne tourne pas forcément sur celle de ce flux.
      const subscription = this.bus.subscribe(
        '*',
        (event) => {
          if (!isForOwner(event, objectiveId, ownerId)) return;
          if (started) subscriber.next(toMessage(event));
          else waiting.push(event);
        },
        { delivery: 'every-instance' },
      );

      const heartbeat = setInterval(() => subscriber.next({ comment: 'ping' }), HEARTBEAT_MS);
      heartbeat.unref();

      void this.workflow.getState(objectiveId, ownerId).then((state) => {
        if (subscriber.closed) return;
        // La conversation a disparu entre-temps : le flux se ferme, la reconnexion dira 404.
        if (!state.success) return subscriber.complete();

        subscriber.next({ type: 'state.changed', data: state.data, retry: RECONNECT_AFTER_MS });
        for (const event of waiting.splice(0)) subscriber.next(toMessage(event));
        started = true;
      });

      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
        this.active.delete(subscriber);
      };
    });
  }
}

function isForOwner(event: BusEvent, objectiveId: string, ownerId: string): boolean {
  return (
    event.source === AI_ASSISTANT_WORKFLOW &&
    event.key === objectiveId &&
    event.ownerId === ownerId &&
    event.audience === 'public'
  );
}

/** Un événement tel que le client le reçoit : son fait (sans le nom du workflow), son id, sa charge. */
function toMessage(event: BusEvent): MessageEvent {
  return { type: event.type.slice(event.source.length + 1), id: event.id, data: event.payload };
}
