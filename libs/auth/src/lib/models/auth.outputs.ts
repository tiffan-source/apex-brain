import { Role, User } from '@org/user';
import { AuthSession } from './auth-session';

/**
 * La personne telle que les cas d'usage la rendent : son nom d'affichage, à défaut son e-mail, et
 * ses rôles (vides pour un compte de base).
 */
export type AuthenticatedUserOutput = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
};

export type AuthSessionOutput = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

export type SignedInOutput = {
  user: AuthenticatedUserOutput;
  session: AuthSessionOutput;
};

export function toAuthenticatedUserOutput(user: User): AuthenticatedUserOutput {
  return {
    id: user.uid,
    name: user.displayName ?? user.email,
    email: user.email,
    roles: [...user.roles],
  };
}

export function toSignedInOutput(session: AuthSession): SignedInOutput {
  return {
    user: toAuthenticatedUserOutput(session.user),
    session: {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    },
  };
}
