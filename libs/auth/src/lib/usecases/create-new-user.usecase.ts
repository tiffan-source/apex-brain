import { Result, runWithResult } from '@org/chore';
import { AuthProvider } from '../protocols/auth.provider';
import { UserAlreadyExistError } from '../errors/user-already-exist.error';
import { WeakPasswordError } from '../errors/weak-password.error';
import { InvalidEmailError } from '../errors/invalid-email.error';
import { AuthRateLimitedError } from '../errors/auth-rate-limited.error';
import {
  AuthenticatedUserOutput,
  AuthSessionOutput,
  toAuthenticatedUserOutput,
  toSignedInOutput,
} from '../models/auth.outputs';

export type CreateNewUserInput = {
  email: string;
  password: string;
};

export type CreateNewUserOutput = {
  user: AuthenticatedUserOutput;
  /** `null` tant que l'adresse e-mail doit être confirmée. */
  session: AuthSessionOutput | null;
};

export class CreateNewUserUseCase {
  constructor(private readonly authProvider: AuthProvider) {}

  execute(input: CreateNewUserInput): Promise<Result<CreateNewUserOutput>> {
    return runWithResult<CreateNewUserOutput>(
      async () => {
        const { user, session } = await this.authProvider.register(input.email, input.password);

        return session ? toSignedInOutput(session) : { user: toAuthenticatedUserOutput(user), session: null };
      },
      [UserAlreadyExistError, WeakPasswordError, InvalidEmailError, AuthRateLimitedError],
      'An unknown error occurred while creating a new user.',
    );
  }
}
