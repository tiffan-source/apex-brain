import { CoreError } from '@org/chore';

export class InvalidEmailError extends CoreError {
  constructor(email: string) {
    super('INVALID_EMAIL', `The email ${email} is not accepted.`);
  }
}
