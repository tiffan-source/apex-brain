import { CoreError } from '@org/chore';

export class FailToSaveTaskError extends CoreError {
  constructor(taskId: string) {
    super('FAIL_TO_SAVE_TASK', `Failed to save task with ID: ${taskId}`, { taskId });
  }
}
