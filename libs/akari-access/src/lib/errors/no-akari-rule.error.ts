import { CoreError } from '@org/chore';

export const NO_AKARI_RULE = 'NO_AKARI_RULE';

/** Aucun des rôles de la personne n'a de règle Akari : un oubli de configuration, ou un retrait voulu. */
export class NoAkariRuleError extends CoreError {
  constructor(roles: readonly string[]) {
    super(NO_AKARI_RULE, `No Akari rule for roles [${roles.join(', ')}]`, { roles: [...roles] });
  }
}
