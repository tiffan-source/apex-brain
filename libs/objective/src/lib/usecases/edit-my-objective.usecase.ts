import { Result, runWithResult } from '@org/chore';
import { FailToSaveObjectiveError } from '../errors/fail-to-save-objective.error';
import { ObjectiveNotFoundError } from '../errors/objective-not-found.error';
import { ObjectiveRepository } from '../protocols/objective.repository';

export interface EditObjectiveInput {
  objective: {
    id: string;
    title: string;
    /** Absent : inchangé. */
    description?: string;
    /** Absent : inchangé. */
    why?: string;
    /** Absent : inchangée ; `null` : l'échéance est retirée. */
    dueDate?: Date | null;
  };
  ownerId: string;
}

export interface EditObjectiveOutput {
  id: string;
  title: string;
  description?: string;
  why?: string;
  dueDate?: Date;
}

export class EditObjectiveUsecase {
  constructor(private readonly repository: ObjectiveRepository) {}

  async execute(input: EditObjectiveInput): Promise<Result<EditObjectiveOutput>> {
    return runWithResult<EditObjectiveOutput>(
      async () => {
        const { id, title, description, why, dueDate } = input.objective;
        const objective = await this.repository.findById(id, input.ownerId);

        if (!objective) {
          throw new ObjectiveNotFoundError(id);
        }

        objective.setTitle(title);

        if (description !== undefined) {
          objective.setDescription(description);
        }

        if (why !== undefined) {
          objective.setWhy(why);
        }

        if (dueDate === null) {
          objective.clearDueDate();
        } else if (dueDate !== undefined) {
          objective.setDueDate(dueDate);
        }

        const saved = await this.repository.save(objective, input.ownerId);

        if (!saved) {
          throw new FailToSaveObjectiveError(objective.id);
        }

        return {
          id: objective.id,
          title: objective.title,
          description: objective.description,
          why: objective.why,
          dueDate: objective.dueDate,
        };
      },
      [ObjectiveNotFoundError, FailToSaveObjectiveError],
      'Failed to edit objective',
    );
  }
}
