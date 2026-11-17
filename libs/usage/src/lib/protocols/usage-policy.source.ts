import { UsagePolicy } from '../models/usage-policy';

/**
 * Les politiques d'usage en vigueur, d'où qu'elles viennent. Elles sont relues à chaque décision : une politique
 * changée, ajoutée ou coupée compte dès la décision suivante.
 */
export abstract class UsagePolicySource {
  /** Les politiques qui nomment cette action, triées par rôle ; aucune : l'action est libre. */
  abstract forAction(action: string): Promise<UsagePolicy[]>;

  /** Toutes les politiques, triées par action puis par rôle. */
  abstract all(): Promise<UsagePolicy[]>;
}
