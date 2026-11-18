import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AkariAccess } from '@org/akari-access';
import { akariQuotaExceeded, forbidden, unauthenticated } from '../http/api-error';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

/**
 * La garde de quota d'Akari, sur la seule route d'envoi d'un message, après la garde des rôles :
 * aucune règle pour aucun des rôles de la personne → `403 FORBIDDEN` (et un avertissement, pour
 * repérer un oubli de configuration) ; quota épuisé → `403 AKARI_QUOTA_EXCEEDED` avec ses détails.
 * Une panne des règles ou du journal remonte en 500 : Akari ne s'ouvre jamais sans limite.
 */
@Injectable()
export class AkariQuotaGuard implements CanActivate {
  private readonly logger = new Logger('AkariQuota');

  constructor(@Inject(AkariAccess) private readonly akariAccess: AkariAccess) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw unauthenticated();

    const decision = await this.akariAccess.check(user);

    switch (decision.type) {
      case 'allowed':
        return true;
      case 'no-rule':
        this.logger.warn(`No Akari rule for user ${user.id} with roles [${user.roles.join(', ')}]`);
        throw forbidden();
      case 'quota-exceeded':
        throw akariQuotaExceeded(decision.quota);
    }
  }
}
