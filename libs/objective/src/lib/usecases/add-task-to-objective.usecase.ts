import { IdGenerator, Result, runWithResult } from '@org/chore';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { Task } from '../models/task';
import { ObjectiveNotFoundError } from '../errors/objective-not-found.error';
import { FailToSaveObjectiveError } from '../errors/fail-to-save-objective.error';
import { TaskCommandOutput, toTaskCommandOutput } from '../mappers/command-output.mapper';

export interface AddTaskToObjectiveInput {
  /** L'objectif ou l'étape qui reçoit le pas. */
  objectiveId: string;
  title: string;
  importance: number;
  urgency: number;
  ownerId: string;
}

export type AddTaskToObjectiveOutput = TaskCommandOutput;

/** Ajouter un pas à un objectif ou à une étape. */
export class AddTaskToObjectiveUsecase {
  constructor(
    private readonly repository: ObjectiveRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: AddTaskToObjectiveInput): Promise<Result<AddTaskToObjectiveOutput>> {
    return runWithResult<AddTaskToObjectiveOutput>(
      async () => {
        const objective = await this.repository.findById(input.objectiveId, input.ownerId);

        if (!objective) {
          throw new ObjectiveNotFoundError(input.objectiveId);
        }

        const newTask = new Task(this.idGenerator.generateId(), input.title, input.importance, input.urgency);
        objective.addTask(newTask);

        const saved = await this.repository.save(objective, input.ownerId);

        if (!saved) {
          throw new FailToSaveObjectiveError(objective.id);
        }

        return toTaskCommandOutput(newTask, objective.id);
      },
      [ObjectiveNotFoundError, FailToSaveObjectiveError],
      'Failed to add task to objective',
    );
  }
}
