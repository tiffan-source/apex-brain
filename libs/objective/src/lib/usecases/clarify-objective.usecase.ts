import { Result, runWithResult } from '@org/chore';
import { ObjectiveCommandOutput } from '../mappers/command-output.mapper';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { editObjective, OBJECTIVE_EDITION_ERRORS } from './edit-objective';

export interface ClarifyObjectiveInput {
  objectiveId: string;
  /** Absent : inchangée ; `''` : vidée. */
  description?: string;
  /** Absent : inchangé ; `''` : vidé. */
  why?: string;
  ownerId: string;
}

/** Préciser ce qu'est un objectif (ou une étape) et pourquoi on le poursuit. */
export class ClarifyObjectiveUsecase {
  constructor(private readonly repository: ObjectiveRepository) {}

  execute(input: ClarifyObjectiveInput): Promise<Result<ObjectiveCommandOutput>> {
    return runWithResult<ObjectiveCommandOutput>(
      () =>
        editObjective(this.repository, input.objectiveId, input.ownerId, (objective) => {
          if (input.description !== undefined) objective.setDescription(input.description);
          if (input.why !== undefined) objective.setWhy(input.why);
        }),
      OBJECTIVE_EDITION_ERRORS,
      'Failed to clarify objective',
    );
  }
}
