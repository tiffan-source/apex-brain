import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Environment } from '../config/environment';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

export type RateLimitCategory = 'auth' | 'assistant-message';

/** Une route plus coûteuse ou plus sensible : sa limite vient de la configuration (THROTTLE_*_LIMIT). */
export const RateLimit = Reflector.createDecorator<RateLimitCategory>();

const reflector = new Reflector();
const WINDOW_MS = 60_000;

/**
 * Limitation de débit sur une minute glissante, par personne connectée (son id), sinon par adresse
 * IP : la connexion et l'inscription sont protégées contre les essais en série, et les messages à
 * l'assistant contre une facture d'IA qui s'emballe.
 */
export function throttlerOptions(environment: Environment): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: WINDOW_MS,
        limit: (context: ExecutionContext) => {
          const category = reflector.getAllAndOverride(RateLimit, [context.getHandler(), context.getClass()]);
          if (category === 'auth') return environment.THROTTLE_AUTH_LIMIT;
          if (category === 'assistant-message') return environment.THROTTLE_ASSISTANT_MESSAGE_LIMIT;
          return environment.THROTTLE_DEFAULT_LIMIT;
        },
      },
    ],
    getTracker: (request: Record<string, unknown>) => {
      const { user, ip } = request as unknown as AuthenticatedRequest & Request;
      return user ? `user:${user.id}` : `ip:${ip ?? 'unknown'}`;
    },
  };
}
