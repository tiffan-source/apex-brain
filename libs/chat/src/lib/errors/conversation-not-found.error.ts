import { CoreError } from '@org/chore';

/** Aucune conversation n'est rattachée à cette référence pour cette personne. */
export class ConversationNotFoundError extends CoreError {
  constructor(externalReferenceId: string) {
    super('CONVERSATION_NOT_FOUND', `No conversation found for reference ${externalReferenceId}`, {
      externalReferenceId,
    });
  }
}
