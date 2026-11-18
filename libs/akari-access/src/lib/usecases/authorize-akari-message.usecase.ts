import { Result, runWithResult } from '@org/chore';
import { Role } from '@org/user';
import { AkariQuotaExceededError } from '../errors/akari-quota-exceeded.error';
import { NoAkariRuleError } from '../errors/no-akari-rule.error';
import { decideAkariAccess, rulesOf } from '../models/akari-access-decision';
import { AkariWindow } from '../models/akari-rule';
import { windowBounds } from '../models/akari-window';
import { AkariRulesQuery } from '../protocols/akari-rules.query';
import { AkariUsageRepository } from '../protocols/akari-usage.repository';
import { Clock } from '../protocols/clock';

export type AuthorizeAkariMessageInput = {
  ownerId: string;
  roles: readonly Role[];
};

/**
 * La personne peut-elle envoyer un message à Akari ? Les règles sont relues à chaque fois. On vérifie
 * à l'envoi et on compte à la fin du tour : des tours simultanés peuvent dépasser un peu le quota.
 */
export class AuthorizeAkariMessageUseCase {
  constructor(
    private readonly rules: AkariRulesQuery,
    private readonly usages: AkariUsageRepository,
    private readonly clock: Clock,
  ) {}

  execute({ ownerId, roles }: AuthorizeAkariMessageInput): Promise<Result<void>> {
    return runWithResult(
      async () => {
        const now = this.clock.now();
        const rules = await this.rules.execute(roles);
        const limitedWindows = new Set<AkariWindow>(
          rulesOf(roles, rules)
            .filter((rule) => rule.messageLimit !== null)
            .map((rule) => rule.window),
        );

        const used: Partial<Record<AkariWindow, number>> = {};
        for (const window of limitedWindows) {
          used[window] = await this.usages.countSince(ownerId, windowBounds(window, now).since);
        }

        const decision = decideAkariAccess({ roles, rules, used, now });
        if (decision.type === 'no-rule') throw new NoAkariRuleError(roles);
        if (decision.type === 'quota-exceeded') throw new AkariQuotaExceededError(decision.quota);
      },
      [NoAkariRuleError, AkariQuotaExceededError],
      'Failed to check the Akari quota',
    );
  }
}
