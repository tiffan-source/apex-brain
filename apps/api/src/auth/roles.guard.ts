import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAnyRole } from '@org/user';
import { forbidden } from '../http/api-error';
import { Roles } from './auth.decorators';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Garde globale, après `AuthGuard` dont elle lit `request.user` : une personne connectée dont aucun
 * rôle n'ouvre la route reçoit `403 FORBIDDEN`. Le métier n'en sait rien (docs/adr/0008-roles.md).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride(Roles, [context.getHandler(), context.getClass()]);

    if (!allowed) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!user || !hasAnyRole(user.roles, allowed)) {
      throw forbidden();
    }

    return true;
  }
}
