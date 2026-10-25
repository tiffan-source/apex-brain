import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUserOutput } from '@org/auth';
import { unauthenticated } from '../http/api-error';
import type { AuthenticatedRequest } from './authenticated-request';

/** Une route ouverte sans jeton (inscription, connexion, renouvellement, santé). */
export const Public = Reflector.createDecorator<boolean>({ transform: () => true });

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
