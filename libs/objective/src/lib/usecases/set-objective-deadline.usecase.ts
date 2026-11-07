import { Result, runWithResult } from '@org/chore';
import { ObjectiveCommandOutput } from '../mappers/command-output.mapper';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { editObjective, OBJECTIVE_EDITION_ERRORS } from './edit-objective';

export interface SetObjectiveDeadlineInput {
  objectiveId: string;
  dueDate: Date;
  ownerId: string;
}

/** Fixer (ou déplacer) l'échéance d'un objectif ou d'une étape. */
export class SetObjectiveDeadlineUsecase {
  constructor(private readonly repository: ObjectiveRepository) {}

  execute(input: SetObjectiveDeadlineInput): Promise<Result<ObjectiveCommandOutput>> {
    return runWithResult<ObjectiveCommandOutput>(
      () =>
        editObjective(this.repository, input.objectiveId, input.ownerId, (objective) =>
          objective.setDueDate(input.dueDate),
        ),
      OBJECTIVE_EDITION_ERRORS,
      'Failed to set objective deadline',
    );
  }
}
