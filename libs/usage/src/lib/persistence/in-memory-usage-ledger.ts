import { TakeResult, UsageCounter, UsageLedger } from '../protocols/usage-ledger';

/**
 * Des compteurs en mémoire, perdus au redémarrage : pour le développement et les tests. Une prise se fait sans
 * `await` entre la lecture et l'écriture : deux prises simultanées ne se croisent jamais.
 */
export class InMemoryUsageLedger extends UsageLedger {
  /** Les comptes, un par compteur. */
  readonly counts = new Map<string, number>();

  async take(counter: UsageCounter, limit: number): Promise<TakeResult> {
    const id = keyOf(counter);
    const used = this.counts.get(id) ?? 0;

    if (used >= limit) {
      return { taken: false, used };
    }

    this.counts.set(id, used + 1);
    return { taken: true, used: used + 1 };
  }

  async giveBack(counter: UsageCounter): Promise<void> {
    const id = keyOf(counter);
    const used = this.counts.get(id) ?? 0;
    if (used > 0) this.counts.set(id, used - 1);
  }

  async used(counter: UsageCounter): Promise<number> {
    return this.counts.get(keyOf(counter)) ?? 0;
  }
}

function keyOf(counter: UsageCounter): string {
  return JSON.stringify([counter.ownerId, counter.action, counter.role, counter.window]);
}
