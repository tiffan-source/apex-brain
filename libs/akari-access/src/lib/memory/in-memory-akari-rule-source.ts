import { Role } from '@org/user';
import { AkariRule, AkariRules, STARTING_AKARI_RULES } from '../models/akari-rule';
import { AkariRuleSource } from '../protocols/akari-rule-source';

/**
 * Les règles en mémoire, préremplies avec les règles de départ : pour le développement local, les
 * tests, et la production tant que Firestore ne les porte pas (issue #13).
 */
export class InMemoryAkariRuleSource extends AkariRuleSource {
  private readonly rules = new Map<Role, AkariRule>();

  constructor(rules: AkariRules = STARTING_AKARI_RULES) {
    super();
    for (const [role, rule] of Object.entries(rules) as Array<[Role, AkariRule]>) this.rules.set(role, rule);
  }

  /** Poser ou remplacer la règle d'un rôle, comme dans la console. */
  set(role: Role, rule: AkariRule): void {
    this.rules.set(role, { ...rule });
  }

  /** Retirer la règle d'un rôle : il n'a plus accès à Akari. */
  delete(role: Role): void {
    this.rules.delete(role);
  }

  async forRoles(roles: readonly Role[]): Promise<AkariRules> {
    const found: AkariRules = {};
    for (const role of roles) {
      const rule = this.rules.get(role);
      if (rule) found[role] = { ...rule };
    }
    return found;
  }
}
