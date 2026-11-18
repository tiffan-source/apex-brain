import { Role } from '@org/user';
import { AkariRules } from '../models/akari-rule';

/** Les règles Akari de ces rôles, relues à chaque appel (elles changent sans déploiement). */
export abstract class AkariRulesQuery {
  abstract execute(roles: readonly Role[]): Promise<AkariRules>;
}
