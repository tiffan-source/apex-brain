import { Role } from '@org/user';
import { AkariRule, AkariRules, AkariWindow } from './akari-rule';
import { windowBounds } from './akari-window';

/** Le quota épuisé, tel que la personne le voit. */
export type AkariQuota = {
  limit: number;
  used: number;
  window: AkariWindow;
  resetsAt: Date | null;
};

export type AkariAccessDecision =
  | { type: 'allowed' }
  /** Aucun des rôles de la personne n'a de règle. */
  | { type: 'no-rule' }
  | { type: 'quota-exceeded'; quota: AkariQuota };

export type AkariAccessInput = {
  roles: readonly Role[];
  rules: AkariRules;
  /** Les messages déjà comptés dans chaque fenêtre des règles limitées. */
  used: Partial<Record<AkariWindow, number>>;
  now: Date;
};

/** Les règles qui s'appliquent à ces rôles. */
export function rulesOf(roles: readonly Role[], rules: AkariRules): AkariRule[] {
  return roles.flatMap((role) => rules[role] ?? []);
}

/**
 * Peut-on écrire à Akari ? Avec plusieurs rôles, la règle la plus généreuse parmi ceux qui ont une
 * règle l'emporte : illimité bat tout, sinon celle qui laisse le plus de messages.
 */
export function decideAkariAccess({ roles, rules, used, now }: AkariAccessInput): AkariAccessDecision {
  const applicable = rulesOf(roles, rules);

  if (applicable.length === 0) return { type: 'no-rule' };
  if (applicable.some((rule) => rule.messageLimit === null)) return { type: 'allowed' };

  const quotas = applicable.map(
    (rule): AkariQuota => ({
      limit: rule.messageLimit as number,
      used: used[rule.window] ?? 0,
      window: rule.window,
      resetsAt: windowBounds(rule.window, now).resetsAt,
    }),
  );
  const best = quotas.reduce((a, b) => (b.limit - b.used > a.limit - a.used ? b : a));

  return best.used < best.limit ? { type: 'allowed' } : { type: 'quota-exceeded', quota: best };
}
