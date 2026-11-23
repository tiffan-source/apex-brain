import { Role } from '@org/user';
import { AkariAccessDecision, decideAkariAccess, rulesOf } from './models/akari-access-decision';
import { AkariWindow } from './models/akari-rule';
import { windowBounds } from './models/akari-window';
import { AkariRuleSource } from './protocols/akari-rule-source';
import { AkariUsageJournal } from './protocols/akari-usage-journal';
import { Clock } from './protocols/clock';

/** La personne qui écrit à Akari : son id et ses rôles. */
export type AkariPerson = {
  id: string;
  roles: readonly Role[];
};

/** Un tour qui s'est terminé par une réponse d'Akari. */
export type AkariTurn = {
  ownerId: string;
  objectiveId: string;
  /** L'id du message réservé pour la réponse d'Akari : un tour rejoué ne compte pas deux fois. */
  replyMessageId: string;
};

/**
 * L'accès à Akari : vérifier qu'une personne peut lui écrire, compter ses tours réussis.
 *
 * Un mécanisme du système, comme l'authentification, et non un cas d'usage : la personne ne fait
 * rien ici, on décide si elle peut, puis on compte ce qu'elle a fait. Un refus est une décision
 * rendue telle quelle, pas une erreur ; seule une panne des règles ou du journal est lancée, et
 * Akari reste alors fermé.
 */
export class AkariAccess {
  constructor(
    private readonly rules: AkariRuleSource,
    private readonly journal: AkariUsageJournal,
    private readonly clock: Clock,
  ) {}

  /**
   * Peut-elle envoyer un message à Akari maintenant ? Les règles sont relues à chaque fois. On vérifie
   * à l'envoi et on compte à la fin du tour : des tours simultanés peuvent dépasser un peu le quota.
   */
  async check({ id, roles }: AkariPerson): Promise<AkariAccessDecision> {
    const now = this.clock.now();
    const rules = await this.rules.forRoles(roles);
    const limitedWindows = new Set<AkariWindow>(
      rulesOf(roles, rules)
        .filter((rule) => rule.messageLimit !== null)
        .map((rule) => rule.window),
    );

    const used: Partial<Record<AkariWindow, number>> = {};
    for (const window of limitedWindows) {
      used[window] = await this.journal.countSince(id, windowBounds(window, now).since);
    }

    return decideAkariAccess({ roles, rules, used, now });
  }

  /** Compter un tour réussi : Akari a répondu, sa réponse est écrite. */
  async record({ ownerId, objectiveId, replyMessageId }: AkariTurn): Promise<void> {
    await this.journal.record(replyMessageId, { ownerId, objectiveId, at: this.clock.now() });
  }
}
