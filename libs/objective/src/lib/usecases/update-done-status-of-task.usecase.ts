import { Result, runWithResult } from '@org/chore';
import { TaskNotFoundError } from '../errors/task-not-found.error';
import { TaskRepository } from '../protocols/task.repository';
import { FailToSaveTaskError } from '../errors/fail-to-save-task.error';

export type UpdateDoneStatusOfTaskInput = {
  taskId: string;
  done: boolean;
  ownerId: string;
};

export type UpdateDoneStatusOfTaskOutput = {
  id: string;
  title: string;
  done: boolean;
};

export class UpdateDoneStatusOfTaskUsecase {
  constructor(private readonly repository: TaskRepository) {}

  async execute(input: UpdateDoneStatusOfTaskInput): Promise<Result<UpdateDoneStatusOfTaskOutput>> {
    return runWithResult<UpdateDoneStatusOfTaskOutput>(
      async () => {
        const task = await this.repository.findById(input.taskId, input.ownerId);

        if (!task) {
          throw new TaskNotFoundError(input.taskId);
        }

        task.setDone(input.done);

        const saved = await this.repository.update(task, input.ownerId);

        if (!saved) {
          throw new FailToSaveTaskError(input.taskId);
        }

        return {
          id: task.id,
          title: task.title,
          done: task.done,
        };
      },
      [TaskNotFoundError, FailToSaveTaskError],
      'Failed to update task status',
    );
  }
}
