import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GrantedReservation } from '@org/usage';
import { heldReservationKey, HeldReservations, UsageGate } from '@org/usage';
import type { Observable } from 'rxjs';
import { catchError, from, switchMap, throwError } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { actionForbidden, quotaExceeded, unauthenticated } from '../http/api-error';
import type { UsageActionMetadata } from '../http/usage-action';
import { UsageAction } from '../http/usage-action';

/**
 * Intercepteur global des politiques d'usage (docs/adr/0010-politiques-d-usage.md). Sur une route marquée
 * `@UsageAction`, il réserve une unité avant d'appeler la route, et la rend si la route échoue. Une route à
 * l'issue différée (un message à Akari) garde son unité réservée jusqu'à ce que l'issue soit connue.
 *
 * Il passe après les gardes : seule une personne authentifiée, autorisée et sous la limite de débit réserve.
 */
@Injectable()
export class UsageInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Usage');

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(UsageGate) private readonly gate: UsageGate,
    @Inject(HeldReservations) private readonly held: HeldReservations,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const declared = this.reflector.getAllAndOverride(UsageAction, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!declared) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { user } = request;

    if (!user) {
      throw unauthenticated();
    }

    // Lue avant de réserver : une route mal déclarée échoue sans avoir pris d'unité.
    const subject = deferredSubject(request, declared);
    const reservation = await this.gate.reserve({ id: user.id, roles: user.roles }, declared.action);

    if (!reservation.granted) {
      if (reservation.reason === 'denied') {
        throw actionForbidden(declared.action);
      }
      this.logger.log(
        `QUOTA_EXCEEDED ${declared.action} (${reservation.quota} per ${reservation.period}) for ${user.id}`,
      );
      throw quotaExceeded(declared.action, reservation.quota, reservation.period);
    }

    // Tenue avant l'appel : un tour très court peut finir avant que la route ait répondu.
    const heldKey =
      reservation.counted && subject !== null ? heldReservationKey(declared.action, user.id, subject) : null;
    if (heldKey) {
      this.held.hold(heldKey, reservation);
    }

    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          from(this.giveBack(reservation, heldKey)).pipe(switchMap(() => throwError(() => error))),
        ),
      );
  }

  /** La route a échoué : l'action n'a pas eu lieu, l'unité est rendue. Une panne du compteur est journalisée. */
  private async giveBack(reservation: GrantedReservation, heldKey: string | null): Promise<void> {
    if (heldKey) {
      this.held.drop(heldKey, reservation);
    }

    try {
      await reservation.release();
    } catch (error) {
      this.logger.error(
        `The unit of ${reservation.action} could not be given back`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

/**
 * L'opération en cours d'une action à l'issue différée : son paramètre de route, tel que le contrôleur le lira
 * (les schémas d'identifiants retirent les espaces autour). `null` pour une action dont la route donne l'issue.
 */
function deferredSubject(request: AuthenticatedRequest, declared: UsageActionMetadata): string | null {
  if (!declared.deferredOutcome) {
    return null;
  }

  const { subjectParam } = declared.deferredOutcome;
  const value = request.params[subjectParam];

  if (typeof value !== 'string') {
    throw new Error(`@UsageAction(${declared.action}): the route has no :${subjectParam} parameter`);
  }

  return value.trim();
}
