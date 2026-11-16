import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TurnEnded } from '@org/ai-assistant';
import { heldReservationKey, HeldReservations } from '@org/usage';
import type { Subscription } from 'rxjs';
import { ASSISTANT_ACTIONS } from '../assistant/assistant.actions';
import { AssistantTurnEvents } from '../assistant/assistant-turn.events';

/**
 * Là où les politiques d'usage rencontrent les tours d'Akari : un message réserve une unité, qui reste
 * réservée jusqu'à la fin du tour. Un tour réussi la garde, un tour arrêté par une panne la rend : on ne fait
 * pas payer une panne de l'IA (docs/adr/0010-politiques-d-usage.md).
 */
@Injectable()
export class AssistantTurnSettlement implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Usage');
  private subscription?: Subscription;

  constructor(
    @Inject(AssistantTurnEvents) private readonly turns: AssistantTurnEvents,
    @Inject(HeldReservations) private readonly held: HeldReservations,
  ) {}

  onModuleInit(): void {
    this.subscription = this.turns.ended$.subscribe((turn) => void this.settle(turn));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private async settle(turn: TurnEnded): Promise<void> {
    try {
      await this.held.settle(
        heldReservationKey(ASSISTANT_ACTIONS.sendMessage, turn.ownerId, turn.objectiveId),
        turn.outcome === 'failed' ? 'failed' : 'succeeded',
      );
    } catch (error) {
      this.logger.error(
        `The unit of a failed turn could not be given back (objective ${turn.objectiveId})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
