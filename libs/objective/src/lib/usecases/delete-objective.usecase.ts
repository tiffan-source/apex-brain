import { Result, runWithResult } from '@org/chore';
import { ObjectiveNotFoundError } from '../errors/objective-not-found.error';
import { ObjectiveRepository } from '../protocols/objective.repository';

export interface DeleteObjectiveInput {
  /** Un objectif ou une étape. */
  objectiveId: string;
  ownerId: string;
}

/** Supprimer un objectif ou une étape, avec tout ce qui en dépend (voir `ObjectiveRepository.delete`). */
export class DeleteObjectiveUsecase {
  constructor(private readonly repository: ObjectiveRepository) {}

  execute(input: DeleteObjectiveInput): Promise<Result<void>> {
    return runWithResult<void>(
      async () => {
        const deleted = await this.repository.delete(input.objectiveId, input.ownerId);

        if (!deleted) {
          throw new ObjectiveNotFoundError(input.objectiveId);
        }
      },
      [ObjectiveNotFoundError],
      'Failed to delete objective',
    );
  }
}
