import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AKARI_QUOTA_EXCEEDED, AuthorizeAkariMessageUseCase, NO_AKARI_RULE } from '@org/akari-access';
import { DomainFailureException, forbidden, unauthenticated } from '../http/api-error';
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

  constructor(
    @Inject(AuthorizeAkariMessageUseCase) private readonly authorize: AuthorizeAkariMessageUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw unauthenticated();

    const result = await this.authorize.execute({ ownerId: user.id, roles: user.roles });
    if (result.success) return true;

    const { error } = result;
    if (error.code === NO_AKARI_RULE) {
      this.logger.warn(`No Akari rule for user ${user.id} with roles [${user.roles.join(', ')}]`);
      throw forbidden();
    }
    if (error.code === AKARI_QUOTA_EXCEEDED) {
      throw new DomainFailureException(error, error.metadata);
    }
    throw new DomainFailureException(error);
  }
}
