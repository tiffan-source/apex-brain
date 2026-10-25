import { CoreError } from '@org/chore';

export class WeakPasswordError extends CoreError {
  constructor(reasons: string[] = []) {
    super('WEAK_PASSWORD', 'The password does not meet the requirements.', { reasons });
  }
}
