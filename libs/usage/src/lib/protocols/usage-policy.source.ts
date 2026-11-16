import { UsagePolicy } from '../models/usage-policy';

/**
 * Les politiques d'usage en vigueur : la table `usage_policies` en production. Elles sont relues à chaque
 * décision, si bien qu'une politique changée compte dès la requête suivante.
 */
export abstract class UsagePolicySource {
  /** Les politiques qui nomment cette action, triées par rôle ; aucune : l'action est libre. */
  abstract forAction(action: string): Promise<UsagePolicy[]>;

  /** Toutes les politiques, triées par action puis par rôle. */
  abstract all(): Promise<UsagePolicy[]>;
}
