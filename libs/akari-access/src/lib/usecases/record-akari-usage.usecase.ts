import { Result, runWithResult } from '@org/chore';
import { AkariUsageRepository } from '../protocols/akari-usage.repository';
import { Clock } from '../protocols/clock';

export type RecordAkariUsageInput = {
  ownerId: string;
  objectiveId: string;
  /** L'id du message réservé pour la réponse d'Akari : un tour rejoué ne compte pas deux fois. */
  replyMessageId: string;
};

/** Compter un tour réussi : Akari a répondu, sa réponse est écrite. */
export class RecordAkariUsageUseCase {
  constructor(
    private readonly usages: AkariUsageRepository,
    private readonly clock: Clock,
  ) {}

  execute({ ownerId, objectiveId, replyMessageId }: RecordAkariUsageInput): Promise<Result<void>> {
    return runWithResult(
      () => this.usages.record(replyMessageId, { ownerId, objectiveId, at: this.clock.now() }),
      [],
      'Failed to record the Akari usage',
    );
  }
}
