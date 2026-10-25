import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GetCurrentUserUseCase } from '@org/auth';
import { unauthenticated } from '../http/api-error';
import { unwrap } from '../http/result';
import { Public } from './auth.decorators';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Garde globale : toute route exige `Authorization: Bearer <jeton>`, sauf celles marquées
 * `@Public()`. Le jeton est vérifié par `GetCurrentUserUseCase` à chaque requête.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(GetCurrentUserUseCase) private readonly getCurrentUser: GetCurrentUserUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride(Public, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = bearerToken(request.headers.authorization);

    if (!accessToken) {
      throw unauthenticated();
    }

    // Un fournisseur d'identité injoignable donne une erreur 500, pas un 401 : on ne
    // déconnecte personne pour une panne.
    const user = unwrap(await this.getCurrentUser.execute({ accessToken }));

    if (!user) {
      throw unauthenticated();
    }

    request.user = user;
    request.accessToken = accessToken;
    return true;
  }
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match ? match[1] : null;
}
