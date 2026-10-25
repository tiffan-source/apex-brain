import { CoreError } from '@org/chore';

/** Le pas n'existe pas, ou n'appartient pas à la personne. */
export class TaskNotFoundError extends CoreError {
  constructor(taskId: string) {
    super('TASK_NOT_FOUND', `Task with ID ${taskId} not found`, { taskId });
  }
}
