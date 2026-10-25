import { Result, runWithResult } from '@org/chore';
import { AuthProvider } from '../protocols/auth.provider';
import { InvalidSessionError } from '../errors/invalid-session.error';
import { AuthRateLimitedError } from '../errors/auth-rate-limited.error';
import { SignedInOutput, toSignedInOutput } from '../models/auth.outputs';

export type RefreshSessionInput = {
  refreshToken: string;
};

/** Prolonger une session : un jeton de renouvellement contre une nouvelle paire de jetons. */
export class RefreshSessionUseCase {
  constructor(private readonly authProvider: AuthProvider) {}

  execute(input: RefreshSessionInput): Promise<Result<SignedInOutput>> {
    return runWithResult<SignedInOutput>(
      async () => toSignedInOutput(await this.authProvider.refresh(input.refreshToken)),
      [InvalidSessionError, AuthRateLimitedError],
      'An unknown error occurred while refreshing the session.',
    );
  }
}
