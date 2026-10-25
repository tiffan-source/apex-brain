import { Result, runWithResult } from '@org/chore';
import { AuthProvider } from '../protocols/auth.provider';

export type LogUserOutInput = {
  accessToken: string;
};

/** Fermer la session de la personne : ses jetons ne valent plus rien. */
export class LogUserOutUseCase {
  constructor(private readonly authProvider: AuthProvider) {}

  execute(input: LogUserOutInput): Promise<Result<void>> {
    return runWithResult<void>(
      () => this.authProvider.logout(input.accessToken),
      [],
      'An unknown error occurred while logging out the user.',
    );
  }
}
