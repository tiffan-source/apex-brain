import { CoreError } from '@org/chore';

/** E-mail inconnu ou mot de passe faux : on ne dit pas lequel. */
export class InvalidCredentialsError extends CoreError {
  constructor() {
    super('INVALID_CREDENTIALS', 'Invalid email or password.');
  }
}
