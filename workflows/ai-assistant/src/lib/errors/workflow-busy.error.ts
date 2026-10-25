import { CoreError } from '@org/chore';

/** Un tour est déjà en cours sur cette conversation : le message n'est pas accepté. */
export class WorkflowBusyError extends CoreError {
  constructor(objectiveId: string) {
    super('WORKFLOW_BUSY', `A turn is already running for objective ${objectiveId}`, { objectiveId });
  }
}
