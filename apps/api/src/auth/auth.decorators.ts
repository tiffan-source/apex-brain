import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUserOutput } from '@org/auth';
import type { Role } from '@org/user';
import { unauthenticated } from '../http/api-error';
import type { AuthenticatedRequest } from './authenticated-request';

/** Une route ouverte sans jeton (inscription, connexion, renouvellement, santé). */
export const Public = Reflector.createDecorator<boolean>({ transform: () => true });

/**
 * Une route (ou toutes celles d'un contrôleur) réservée à ces rôles : un seul suffit. Posé sur une
 * méthode, il remplace celui du contrôleur. Sans `@Roles`, toute personne connectée passe.
 */
export const Roles = Reflector.createDecorator<Role[]>();

/** La personne authentifiée par la garde. */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedUserOutput => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw unauthenticated();
    return user;
  },
);

/** Le jeton d'accès présenté par la requête. */
export const AccessToken = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const { accessToken } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!accessToken) throw unauthenticated();
  return accessToken;
});
