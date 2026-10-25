import { Result, runWithResult } from '@org/chore';
import { AuthProvider } from '../protocols/auth.provider';
import { InvalidCredentialsError } from '../errors/invalid-credentials.error';
import { EmailNotConfirmedError } from '../errors/email-not-confirmed.error';
import { AuthRateLimitedError } from '../errors/auth-rate-limited.error';
import { SignedInOutput, toSignedInOutput } from '../models/auth.outputs';

export type LogUserInInput = {
  email: string;
  password: string;
};

export class LogUserInUseCase {
  constructor(private readonly authProvider: AuthProvider) {}

  execute(input: LogUserInInput): Promise<Result<SignedInOutput>> {
    return runWithResult<SignedInOutput>(
      async () => toSignedInOutput(await this.authProvider.login(input.email, input.password)),
      [InvalidCredentialsError, EmailNotConfirmedError, AuthRateLimitedError],
      'An unknown error occurred while logging in the user.',
    );
  }
}
