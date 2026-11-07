import { Result, runWithResult } from '@org/chore';
import { TaskCommandOutput } from '../mappers/command-output.mapper';
import { TaskRepository } from '../protocols/task.repository';
import { editTask, TASK_EDITION_ERRORS } from './edit-task';

export interface ReopenTaskInput {
  taskId: string;
  ownerId: string;
}

/** Remettre un pas à faire. Pas encore fait, la commande réussit sans effet. */
export class ReopenTaskUsecase {
  constructor(private readonly repository: TaskRepository) {}

  execute(input: ReopenTaskInput): Promise<Result<TaskCommandOutput>> {
    return runWithResult<TaskCommandOutput>(
      () => editTask(this.repository, input.taskId, input.ownerId, (task) => task.setDone(false)),
      TASK_EDITION_ERRORS,
      'Failed to reopen task',
    );
  }
}
