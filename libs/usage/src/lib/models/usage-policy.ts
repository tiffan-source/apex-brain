import { Role } from '@org/user';

/**
 * Les périodes d'un quota. Il repart de zéro au début de chaque jour ou de chaque mois (UTC) ; jamais pour
 * `lifetime`.
 */
export const USAGE_PERIODS = ['lifetime', 'day', 'month'] as const;

export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export function isUsagePeriod(value: unknown): value is UsagePeriod {
  return typeof value === 'string' && (USAGE_PERIODS as readonly string[]).includes(value);
}

/**
 * Une politique d'usage, une ligne de la table `usage_policies` : ce rôle peut faire cette action `quota` fois
 * par période, ou sans limite. Une action qu'aucune politique ne nomme est libre
 * (voir docs/adr/0010-politiques-d-usage.md).
 */
export type UsagePolicy = {
  /** L'action gouvernée, telle qu'une route la déclare (`assistant.send-message`). */
  action: string;
  role: Role;
  /** Le nombre de fois par période ; `null` : sans limite ; `0` : aucune. */
  quota: number | null;
  period: UsagePeriod;
};
