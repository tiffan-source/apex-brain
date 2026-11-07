import { Result, runWithResult } from '@org/chore';
import { TaskCommandOutput } from '../mappers/command-output.mapper';
import { TaskRepository } from '../protocols/task.repository';
import { editTask, TASK_EDITION_ERRORS } from './edit-task';

export interface CompleteTaskInput {
  taskId: string;
  ownerId: string;
}

/** Marquer un pas comme fait. Déjà fait, la commande réussit sans effet. */
export class CompleteTaskUsecase {
  constructor(private readonly repository: TaskRepository) {}

  execute(input: CompleteTaskInput): Promise<Result<TaskCommandOutput>> {
    return runWithResult<TaskCommandOutput>(
      () => editTask(this.repository, input.taskId, input.ownerId, (task) => task.setDone(true)),
      TASK_EDITION_ERRORS,
      'Failed to complete task',
    );
  }
}
