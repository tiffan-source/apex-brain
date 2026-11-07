import { Result, runWithResult } from '@org/chore';
import { TaskCommandOutput } from '../mappers/command-output.mapper';
import { TaskRepository } from '../protocols/task.repository';
import { editTask, TASK_EDITION_ERRORS } from './edit-task';

export interface RenameTaskInput {
  taskId: string;
  title: string;
  ownerId: string;
}

/** Donner un nouveau titre à un pas. */
export class RenameTaskUsecase {
  constructor(private readonly repository: TaskRepository) {}

  execute(input: RenameTaskInput): Promise<Result<TaskCommandOutput>> {
    return runWithResult<TaskCommandOutput>(
      () => editTask(this.repository, input.taskId, input.ownerId, (task) => task.setTitle(input.title)),
      TASK_EDITION_ERRORS,
      'Failed to rename task',
    );
  }
}
