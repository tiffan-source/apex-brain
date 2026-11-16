import { UsagePeriod } from './usage-policy';

/** La fenêtre de comptage d'une période, à un instant donné. */
export type UsageWindow = {
  /** `lifetime`, le jour (`2026-11-16`) ou le mois (`2026-11`), en UTC : la clé du compteur. */
  key: string;
  /** L'instant où le compte repart de zéro ; `null` pour `lifetime`, qui ne repart jamais. */
  resetsAt: Date | null;
};

/** La fenêtre en cours d'une période : les jours et les mois sont ceux de l'UTC. */
export function usageWindow(period: UsagePeriod, now: Date): UsageWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  switch (period) {
    case 'lifetime':
      return { key: 'lifetime', resetsAt: null };
    case 'day':
      return {
        key: now.toISOString().slice(0, 10),
        resetsAt: new Date(Date.UTC(year, month, now.getUTCDate() + 1)),
      };
    case 'month':
      return { key: now.toISOString().slice(0, 7), resetsAt: new Date(Date.UTC(year, month + 1, 1)) };
  }
}
