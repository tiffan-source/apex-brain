import { CoreError } from '@org/chore';

export class EmailNotConfirmedError extends CoreError {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 'The email address has not been confirmed yet.');
  }
}
