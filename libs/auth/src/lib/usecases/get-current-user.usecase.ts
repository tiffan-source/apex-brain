import { Result, runWithResult } from '@org/chore';
import { AuthProvider } from '../protocols/auth.provider';
import { AuthenticatedUserOutput, toAuthenticatedUserOutput } from '../models/auth.outputs';

export type GetCurrentUserInput = {
  accessToken: string;
};

export type GetCurrentOutput = AuthenticatedUserOutput;

/**
 * La personne derrière un jeton d'accès : `null` quand le jeton ne vaut rien (expiré,
 * révoqué, mal formé). Le serveur l'utilise pour authentifier chaque requête.
 */
export class GetCurrentUserUseCase {
  constructor(private readonly authProvider: AuthProvider) {}

  async execute(input: GetCurrentUserInput): Promise<Result<GetCurrentOutput | null>> {
    return runWithResult<GetCurrentOutput | null>(
      async () => {
        const user = await this.authProvider.whoAmI(input.accessToken);
        return user ? toAuthenticatedUserOutput(user) : null;
      },
      [],
      'An unknown error occurred while fetching the current user.',
    );
  }
}
