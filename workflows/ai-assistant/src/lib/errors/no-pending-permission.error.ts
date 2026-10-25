import { CoreError } from '@org/chore';

/** Aucun outil n'attend l'accord de la personne (ou plus celui auquel elle répond). */
export class NoPendingPermissionError extends CoreError {
  constructor(objectiveId: string) {
    super('NO_PENDING_PERMISSION', `No tool is waiting for permission for objective ${objectiveId}`, {
      objectiveId,
    });
  }
}
