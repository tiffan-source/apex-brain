import { CoreError } from '@org/chore';

/** Le jeton de renouvellement est inconnu, expiré ou déjà utilisé : il faut se reconnecter. */
export class InvalidSessionError extends CoreError {
  constructor() {
    super('INVALID_SESSION', 'The session is invalid or has expired.');
  }
}
