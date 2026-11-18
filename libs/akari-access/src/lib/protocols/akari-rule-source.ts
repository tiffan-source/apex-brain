import { Role } from '@org/user';
import { AkariRules } from '../models/akari-rule';

/** D'où viennent les règles Akari des rôles. Elles changent sans déploiement : relues à chaque appel. */
export abstract class AkariRuleSource {
  /** Les règles de ces rôles ; un rôle sans règle n'y figure pas. */
  abstract forRoles(roles: readonly Role[]): Promise<AkariRules>;
}
