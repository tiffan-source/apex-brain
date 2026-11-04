import { Result, runWithResult } from '@org/chore';
import { TaskNotFoundError } from '../errors/task-not-found.error';
import { TaskRepository } from '../protocols/task.repository';

export interface DeleteTaskInput {
  taskId: string;
  ownerId: string;
}

export class DeleteTaskUsecase {
  constructor(private readonly repository: TaskRepository) {}

  execute(input: DeleteTaskInput): Promise<Result<void>> {
    return runWithResult<void>(
      async () => {
        const deleted = await this.repository.delete(input.taskId, input.ownerId);

        if (!deleted) {
          throw new TaskNotFoundError(input.taskId);
        }
      },
      [TaskNotFoundError],
      'Failed to delete task',
    );
  }
}
