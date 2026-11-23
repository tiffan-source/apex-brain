import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AssistantEventPayload } from '@org/ai-assistant';
import { AI_ASSISTANT_EVENTS } from '@org/ai-assistant';
import { AkariAccess } from '@org/akari-access';
import type { BusSubscription } from '@org/event-bus';
import { EventBus } from '@org/event-bus';

/**
 * Ce que l'API fait des tours de l'assistant, en abonnée du bus (docs/adr/0010) : le workflow les annonce
 * sans savoir qui écoute.
 */
@Injectable()
export class AssistantSubscribers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Assistant');
  private subscriptions: BusSubscription[] = [];

  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(AkariAccess) private readonly akariAccess: AkariAccess,
  ) {}

  onModuleInit(): void {
    this.subscriptions = [
      // Chaque tour réussi entre au journal d'usage d'Akari, sous l'id de la réponse : un tour rejoué
      // après un redémarrage est annoncé de nouveau sous le même id, et ne compte qu'une fois.
      this.bus.subscribe(AI_ASSISTANT_EVENTS.turnSucceeded, (event) => {
        const { replyMessageId } = event.payload as AssistantEventPayload<'turn.succeeded'>;
        return this.akariAccess.record({ ownerId: event.ownerId, objectiveId: event.key, replyMessageId });
      }),
      // Une panne de tour (IA, base…) n'arrête pas le workflow : on la journalise, avec son détail.
      this.bus.subscribe(AI_ASSISTANT_EVENTS.turnFailed, (event) => {
        const { code, step, message } = event.payload as AssistantEventPayload<'turn.failed'>;
        this.logger.error(`Workflow ${event.key}: ${code} during ${step}: ${message}`);
      }),
    ];
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.subscriptions = [];
  }
}
