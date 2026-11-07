import { Result, runWithResult } from '@org/chore';
import { ObjectiveCommandOutput } from '../mappers/command-output.mapper';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { editObjective, OBJECTIVE_EDITION_ERRORS } from './edit-objective';

export interface RenameObjectiveInput {
  objectiveId: string;
  title: string;
  ownerId: string;
}

/** Donner un nouveau titre à un objectif ou à une étape. */
export class RenameObjectiveUsecase {
  constructor(private readonly repository: ObjectiveRepository) {}

  execute(input: RenameObjectiveInput): Promise<Result<ObjectiveCommandOutput>> {
    return runWithResult<ObjectiveCommandOutput>(
      () =>
        editObjective(this.repository, input.objectiveId, input.ownerId, (objective) =>
          objective.setTitle(input.title),
        ),
      OBJECTIVE_EDITION_ERRORS,
      'Failed to rename objective',
    );
  }
}
