import type { Request } from 'express';
import type { AuthenticatedUserOutput } from '@org/auth';

/** La requête après la garde d'authentification : la personne et son jeton. */
export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUserOutput;
  accessToken?: string;
};
