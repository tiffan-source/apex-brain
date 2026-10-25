import { CoreError } from '@org/chore';

export class UserAlreadyExistError extends CoreError {
  constructor(email: string) {
    super('USER_ALREADY_EXIST', `A user with the email ${email} already exists.`);
  }
}
