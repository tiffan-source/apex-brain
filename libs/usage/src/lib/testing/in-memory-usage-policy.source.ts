import { UsagePolicy } from '../models/usage-policy';
import { UsagePolicySource } from '../protocols/usage-policy.source';

const byActionThenRole = (a: UsagePolicy, b: UsagePolicy) =>
  a.action.localeCompare(b.action) || a.role.localeCompare(b.role);

/**
 * Des politiques en mémoire, modifiables pendant un test : le changement compte dès la décision suivante, comme
 * en production.
 */
export class InMemoryUsagePolicySource extends UsagePolicySource {
  private policies: UsagePolicy[];

  constructor(policies: readonly UsagePolicy[] = []) {
    super();
    this.policies = policies.map((policy) => ({ ...policy }));
  }

  /** Ajouter la politique d'un rôle sur une action, ou la remplacer (un `upsert` sur la clé action + rôle). */
  set(policy: UsagePolicy): void {
    this.policies = [
      ...this.policies.filter((current) => current.action !== policy.action || current.role !== policy.role),
      { ...policy },
    ];
  }

  /** Retirer les politiques d'une action, comme quand on la coupe : elle devient libre. */
  removeAction(action: string): void {
    this.policies = this.policies.filter((policy) => policy.action !== action);
  }

  async forAction(action: string): Promise<UsagePolicy[]> {
    return this.policies
      .filter((policy) => policy.action === action)
      .sort(byActionThenRole)
      .map((policy) => ({ ...policy }));
  }

  async all(): Promise<UsagePolicy[]> {
    return [...this.policies].sort(byActionThenRole).map((policy) => ({ ...policy }));
  }
}
