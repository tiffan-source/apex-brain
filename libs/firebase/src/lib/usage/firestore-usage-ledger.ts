import type { TakeResult, UsageCounter, UsageLedger } from '@org/usage';
import { usageCounterId } from '@org/usage';

const COLLECTION = 'usage-counters';

/** Ce qu'on lit d'un document de compteur. */
export interface CounterSnapshot {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

/** Un document de compteur. */
export interface CounterReference {
  get(): Promise<CounterSnapshot>;
}

/** Le strict nécessaire d'une transaction Firestore : lire, puis écrire. */
export interface CounterTransaction {
  get(reference: CounterReference): Promise<CounterSnapshot>;
  set(reference: CounterReference, data: Record<string, unknown>): unknown;
}

/** Le strict nécessaire de Firestore pour compter, remplaçable dans les tests. */
export interface CounterStore {
  collection(name: string): { doc(id: string): CounterReference };
  runTransaction<T>(update: (transaction: CounterTransaction) => Promise<T>): Promise<T>;
}

/** Un compteur tel qu'il est stocké : lisible dans la console Firestore, sans rien du métier. */
type UsageCounterDocument = {
  ownerId: string;
  action: string;
  role: string;
  window: string;
  used: number;
  updatedAt: string;
};

/**
 * Les compteurs des politiques d'usage dans Firestore, collection `usage-counters`, un document par compteur
 * (voir docs/adr/0010-politiques-d-usage.md). Hors de la base métier : ils disparaissent avec la stratégie qui
 * les a fait naître, sans migration.
 *
 * Chaque prise est une transaction : côté serveur, le SDK Admin verrouille le document lu jusqu'à l'écriture,
 * et relance la fonction en cas de conflit. Deux envois simultanés ne dépassent donc jamais la limite.
 */
export class FirestoreUsageLedger implements UsageLedger {
  constructor(
    private readonly firebase: { db: CounterStore },
    private readonly now: () => Date = () => new Date(),
  ) {}

  take(counter: UsageCounter, limit: number): Promise<TakeResult> {
    const reference = this.reference(counter);

    return this.firebase.db.runTransaction(async (transaction) => {
      const used = usedIn(await transaction.get(reference));

      if (used >= limit) {
        return { taken: false, used };
      }

      transaction.set(reference, this.document(counter, used + 1));
      return { taken: true, used: used + 1 };
    });
  }

  async giveBack(counter: UsageCounter): Promise<void> {
    const reference = this.reference(counter);

    await this.firebase.db.runTransaction(async (transaction) => {
      const used = usedIn(await transaction.get(reference));
      if (used > 0) transaction.set(reference, this.document(counter, used - 1));
    });
  }

  async used(counter: UsageCounter): Promise<number> {
    return usedIn(await this.reference(counter).get());
  }

  private reference(counter: UsageCounter): CounterReference {
    return this.firebase.db.collection(COLLECTION).doc(usageCounterId(counter));
  }

  private document(counter: UsageCounter, used: number): UsageCounterDocument {
    return {
      ownerId: counter.ownerId,
      action: counter.action,
      role: counter.role,
      window: counter.window,
      used,
      updatedAt: this.now().toISOString(),
    };
  }
}

/** Le compte d'un document ; 0 pour un compteur absent ou illisible. */
function usedIn(snapshot: CounterSnapshot): number {
  const used = snapshot.exists ? snapshot.data()?.['used'] : undefined;
  return typeof used === 'number' && Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
}
