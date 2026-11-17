import { Role } from '@org/user';
import { UsagePeriod, UsagePolicy } from './usage-policy';

/** Ce qu'une personne peut faire d'une action, d'après ses rôles et les politiques en vigueur. */
export type Allowance =
  /** Aucune politique ne nomme l'action : rien n'est vérifié ni compté. */
  | { access: 'free' }
  /** L'action est gouvernée, et aucun rôle de la personne n'y a droit. */
  | { access: 'denied' }
  /** Un de ses rôles y a droit sans limite : rien n'est compté. */
  | { access: 'unlimited' }
  /** Son droit le plus généreux : `quota` fois par période, sur le compteur de ce rôle. */
  | { access: 'limited'; role: Role; quota: number; period: UsagePeriod };

type LimitedPolicy = UsagePolicy & { quota: number };

/** À quota égal, la période qui repart le plus souvent est la plus généreuse. */
const PERIOD_RANK: Readonly<Record<UsagePeriod, number>> = { day: 0, month: 1, lifetime: 2 };

/**
 * Le droit d'une personne sur une action. Entre ses rôles, le plus généreux l'emporte : sans limite, sinon le
 * plus grand quota, à quota égal la période la plus courte, puis le nom du rôle (un même état donne toujours le
 * même compteur).
 */
export function allowanceFor(
  roles: readonly Role[],
  action: string,
  policies: readonly UsagePolicy[],
): Allowance {
  const governing = policies.filter((policy) => policy.action === action);
  if (governing.length === 0) return { access: 'free' };

  const granted = governing.filter((policy) => roles.includes(policy.role));
  if (granted.length === 0) return { access: 'denied' };

  if (granted.some((policy) => policy.quota === null)) return { access: 'unlimited' };

  const [best] = granted
    .filter((policy): policy is LimitedPolicy => policy.quota !== null)
    .sort(
      (a, b) =>
        b.quota - a.quota || PERIOD_RANK[a.period] - PERIOD_RANK[b.period] || a.role.localeCompare(b.role),
    );

  return { access: 'limited', role: best.role, quota: best.quota, period: best.period };
}
