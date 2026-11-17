import { Role } from '@org/user';
import { Allowance, allowanceFor } from './models/allowance';
import { UsagePeriod, UsagePolicy } from './models/usage-policy';
import { usageWindow } from './models/usage-window';
import { UsageCounter, UsageLedger } from './protocols/usage-ledger';
import { UsagePolicySource } from './protocols/usage-policy.source';

/** La personne qui agit : son id et ses rôles (jamais vides : `standard` par défaut, voir `libs/user`). */
export type UsagePerson = { id: string; roles: readonly Role[] };

/** L'action peut avoir lieu : une unité est réservée, ou il n'y avait rien à compter. */
export type GrantedReservation = {
  granted: true;
  action: string;
  /** Une unité a été prise : l'action est limitée pour cette personne. */
  counted: boolean;
  /**
   * Rendre l'unité quand l'action a échoué. Sans effet si rien n'a été compté, et à partir du second appel :
   * une unité n'est jamais rendue deux fois.
   */
  release(): Promise<void>;
};

/** L'action est refusée à cette personne. */
export type RefusedReservation =
  /** Aucun de ses rôles n'y a droit. */
  | { granted: false; action: string; reason: 'denied' }
  /** Son quota est atteint pour la période en cours. */
  | {
      granted: false;
      action: string;
      reason: 'quota-exceeded';
      quota: number;
      used: number;
      period: UsagePeriod;
      /** Le début de la période suivante ; `null` quand le quota ne repart jamais (`lifetime`). */
      resetsAt: Date | null;
    };

export type Reservation = GrantedReservation | RefusedReservation;

/** Où en est une personne sur une action gouvernée. */
export type ActionUsage =
  | { action: string; access: 'unlimited' }
  | { action: string; access: 'denied' }
  | {
      action: string;
      access: 'limited';
      quota: number;
      used: number;
      remaining: number;
      period: UsagePeriod;
      resetsAt: Date | null;
    };

/**
 * L'application des politiques d'usage : réserver une unité avant une action, dire à une personne ce qu'il lui
 * reste. Ne sait rien des routes ni du métier : elle reçoit une personne et le nom d'une action
 * (voir docs/adr/0010-politiques-d-usage.md).
 */
export class UsageGate {
  constructor(
    private readonly policies: UsagePolicySource,
    private readonly ledger: UsageLedger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Réserver une unité de cette action pour cette personne. Une action libre ou sans limite pour elle passe
   * sans rien compter ; une action limitée prend une unité, en un seul geste, tant que le quota le permet.
   */
  async reserve(person: UsagePerson, action: string): Promise<Reservation> {
    const allowance = allowanceFor(person.roles, action, await this.policies.forAction(action));

    switch (allowance.access) {
      case 'free':
      case 'unlimited':
        return granted(action, null);
      case 'denied':
        return { granted: false, action, reason: 'denied' };
      case 'limited': {
        const window = usageWindow(allowance.period, this.now());
        const counter = counterOf(person, action, allowance, window.key);
        const { taken, used } = await this.ledger.take(counter, allowance.quota);

        if (!taken) {
          return {
            granted: false,
            action,
            reason: 'quota-exceeded',
            quota: allowance.quota,
            used,
            period: allowance.period,
            resetsAt: window.resetsAt,
          };
        }

        return granted(action, () => this.ledger.giveBack(counter));
      }
    }
  }

  /** Ce que la personne peut faire de chaque action gouvernée, par ordre d'action. Une action libre n'y figure pas. */
  async usageOf(person: UsagePerson): Promise<ActionUsage[]> {
    const policies = await this.policies.all();
    const actions = [...new Set(policies.map((policy) => policy.action))].sort();
    const now = this.now();

    const usages = await Promise.all(actions.map((action) => this.describe(person, action, policies, now)));
    return usages.filter((usage): usage is ActionUsage => usage !== null);
  }

  private async describe(
    person: UsagePerson,
    action: string,
    policies: readonly UsagePolicy[],
    now: Date,
  ): Promise<ActionUsage | null> {
    const allowance = allowanceFor(person.roles, action, policies);

    switch (allowance.access) {
      case 'free':
        return null;
      case 'denied':
      case 'unlimited':
        return { action, access: allowance.access };
      case 'limited': {
        const window = usageWindow(allowance.period, now);
        const used = await this.ledger.used(counterOf(person, action, allowance, window.key));
        return {
          action,
          access: 'limited',
          quota: allowance.quota,
          used,
          remaining: Math.max(0, allowance.quota - used),
          period: allowance.period,
          resetsAt: window.resetsAt,
        };
      }
    }
  }
}

function counterOf(
  person: UsagePerson,
  action: string,
  allowance: Extract<Allowance, { access: 'limited' }>,
  window: string,
): UsageCounter {
  return { ownerId: person.id, action, role: allowance.role, window };
}

/** Une réservation accordée ; `giveBack` rend l'unité prise (`null` : rien n'a été compté). */
function granted(action: string, giveBack: (() => Promise<void>) | null): GrantedReservation {
  let released = false;

  return {
    granted: true,
    action,
    counted: giveBack !== null,
    release: async () => {
      if (released || !giveBack) return;
      released = true;
      await giveBack();
    },
  };
}
