import { CoreError } from '@org/chore';

export class UnknownUserError extends CoreError {
  constructor(identifier: string) {
    super('UNKNOWN_USER', `No user found with the identifier: ${identifier}`);
  }
}
