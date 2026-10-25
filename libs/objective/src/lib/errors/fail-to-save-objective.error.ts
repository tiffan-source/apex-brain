import { CoreError } from '@org/chore';

export class FailToSaveObjectiveError extends CoreError {
  constructor(objectiveId: string) {
    super('FAIL_TO_SAVE_OBJECTIVE', `Failed to save objective with ID: ${objectiveId}`, { objectiveId });
  }
}
