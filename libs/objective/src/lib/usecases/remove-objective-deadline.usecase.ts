import { Result, runWithResult } from '@org/chore';
import { ObjectiveCommandOutput } from '../mappers/command-output.mapper';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { editObjective, OBJECTIVE_EDITION_ERRORS } from './edit-objective';

export interface RemoveObjectiveDeadlineInput {
  objectiveId: string;
  ownerId: string;
}

/** Retirer l'échéance d'un objectif ou d'une étape. Sans échéance, la commande réussit sans effet. */
export class RemoveObjectiveDeadlineUsecase {
  constructor(private readonly repository: ObjectiveRepository) {}

  execute(input: RemoveObjectiveDeadlineInput): Promise<Result<ObjectiveCommandOutput>> {
    return runWithResult<ObjectiveCommandOutput>(
      () =>
        editObjective(this.repository, input.objectiveId, input.ownerId, (objective) =>
          objective.clearDueDate(),
        ),
      OBJECTIVE_EDITION_ERRORS,
      'Failed to remove objective deadline',
    );
  }
}
