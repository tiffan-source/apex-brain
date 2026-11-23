import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AssistantEventPayload } from '@org/ai-assistant';
import { AI_ASSISTANT_EVENTS } from '@org/ai-assistant';
import { AkariAccess } from '@org/akari-access';
import { EventBus } from '@org/event-bus';

/**
 * Ce que l'API fait des tours de l'assistant, en abonnée du bus (docs/adr/0010) : le workflow les annonce
 * sans savoir qui écoute. Des réactions du serveur, livrées sur une seule instance (celle où le tour a eu
 * lieu), pour qu'un tour ne compte pas autant de fois qu'il y a d'instances.
 *
 * Les abonnements durent autant que le bus : à l'arrêt, le runtime publie ses derniers événements, puis le
 * bus les remet avant de se fermer (`ProductionAdaptersModule`). Se désabonner plus tôt les perdrait.
 */
@Injectable()
export class AssistantSubscribers implements OnModuleInit {
  private readonly logger = new Logger('Assistant');

  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(AkariAccess) private readonly akariAccess: AkariAccess,
  ) {}

  onModuleInit(): void {
    // Chaque tour réussi entre au journal d'usage d'Akari, sous l'id de la réponse : un tour rejoué
    // après un redémarrage est annoncé de nouveau sous le même id, et ne compte qu'une fois.
    this.bus.subscribe(AI_ASSISTANT_EVENTS.turnSucceeded, (event) => {
      const { replyMessageId } = event.payload as AssistantEventPayload<'turn.succeeded'>;
      return this.akariAccess.record({ ownerId: event.ownerId, objectiveId: event.key, replyMessageId });
    });

    // Une panne de tour (IA, base…) n'arrête pas le workflow : on la journalise, avec son détail.
    this.bus.subscribe(AI_ASSISTANT_EVENTS.turnFailed, (event) => {
      const { code, step, message } = event.payload as AssistantEventPayload<'turn.failed'>;
      this.logger.error(`Workflow ${event.key}: ${code} during ${step}: ${message}`);
    });
  }
}
