import { CoreError } from '@org/chore';
import { AkariQuota } from '../models/akari-access-decision';

export const AKARI_QUOTA_EXCEEDED = 'AKARI_QUOTA_EXCEEDED';

/** La personne a envoyé tous les messages que sa règle lui accorde dans la fenêtre. */
export class AkariQuotaExceededError extends CoreError {
  constructor(quota: AkariQuota) {
    super(
      AKARI_QUOTA_EXCEEDED,
      `Akari message quota exceeded (${quota.used}/${quota.limit}, window ${quota.window})`,
      {
        limit: quota.limit,
        used: quota.used,
        window: quota.window,
        resetsAt: quota.resetsAt?.toISOString() ?? null,
      },
    );
  }
}
