import type { UsageCounter } from '@org/usage';
import {
  CounterReference,
  CounterSnapshot,
  CounterStore,
  CounterTransaction,
  FirestoreUsageLedger,
} from './firestore-usage-ledger';

type StoredDocument = { version: number; data: Record<string, unknown> };

class FakeReference implements CounterReference {
  constructor(
    private readonly store: FakeTransactionalFirestore,
    readonly path: string,
  ) {}

  async get(): Promise<CounterSnapshot> {
    return snapshotOf(this.store.documents.get(this.path));
  }
}

function snapshotOf(document: StoredDocument | undefined): CounterSnapshot {
  return {
    exists: document !== undefined,
    data: () => (document ? structuredClone(document.data) : undefined),
  };
}

/**
 * Une Firestore en mémoire avec de vraies transactions concurrentes : chaque lecture rend la main (une autre
 * transaction peut s'intercaler), toutes les lectures précèdent les écritures comme l'exige Firestore, et une
 * transaction dont un document lu a changé entre-temps est relancée au lieu d'écraser l'autre.
 */
class FakeTransactionalFirestore implements CounterStore {
  readonly documents = new Map<string, StoredDocument>();
  retries = 0;

  collection(name: string) {
    return { doc: (id: string) => new FakeReference(this, `${name}/${id}`) };
  }

  async runTransaction<T>(update: (transaction: CounterTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const reads = new Map<string, number>();
      const writes = new Map<string, Record<string, unknown>>();

      const transaction: CounterTransaction = {
        get: async (reference) => {
          if (writes.size > 0) throw new Error('Firestore transactions require all reads before all writes');
          const { path } = reference as FakeReference;
          const document = this.documents.get(path);
          reads.set(path, document?.version ?? 0);
          const snapshot = snapshotOf(document);
          // La main passe après la lecture : les transactions simultanées lisent le même état, puis se
          // disputent l'écriture.
          await new Promise((resolve) => setTimeout(resolve, 0));
          return snapshot;
        },
        set: (reference, data) => {
          writes.set((reference as FakeReference).path, structuredClone(data));
          return transaction;
        },
      };

      const result = await update(transaction);

      // Validation et écriture d'un seul tenant, sans `await` : rien ne peut s'intercaler.
      const conflict = [...reads].some(
        ([path, version]) => (this.documents.get(path)?.version ?? 0) !== version,
      );
      if (conflict) {
        this.retries += 1;
        continue;
      }
      for (const [path, data] of writes) {
        this.documents.set(path, { version: (this.documents.get(path)?.version ?? 0) + 1, data });
      }
      return result;
    }

    throw new Error('Too much contention on these documents');
  }
}

const counter: UsageCounter = {
  ownerId: 'alice',
  action: 'assistant.send-message',
  role: 'standard',
  window: 'lifetime',
};

function setup() {
  const firestore = new FakeTransactionalFirestore();
  const ledger = new FirestoreUsageLedger({ db: firestore }, () => new Date('2026-11-16T10:00:00.000Z'));
  return { firestore, ledger };
}

describe('FirestoreUsageLedger', () => {
  it('prend une unité tant que le compteur est sous la limite, dans un document lisible', async () => {
    const { firestore, ledger } = setup();

    await expect(ledger.take(counter, 2)).resolves.toEqual({ taken: true, used: 1 });
    await expect(ledger.take(counter, 2)).resolves.toEqual({ taken: true, used: 2 });
    await expect(ledger.take(counter, 2)).resolves.toEqual({ taken: false, used: 2 });

    expect(
      firestore.documents.get('usage-counters/alice|assistant.send-message|standard|lifetime')?.data,
    ).toEqual({
      ownerId: 'alice',
      action: 'assistant.send-message',
      role: 'standard',
      window: 'lifetime',
      used: 2,
      updatedAt: '2026-11-16T10:00:00.000Z',
    });
  });

  it('ne dépasse jamais la limite quand dix prises arrivent en même temps', async () => {
    const { firestore, ledger } = setup();

    const results = await Promise.all(Array.from({ length: 10 }, () => ledger.take(counter, 3)));

    expect(results.filter((result) => result.taken)).toHaveLength(3);
    await expect(ledger.used(counter)).resolves.toBe(3);
    // Les transactions se sont bien croisées : la fausse Firestore en a relancé.
    expect(firestore.retries).toBeGreaterThan(0);
  });

  it("rend une unité sans descendre sous zéro, même en même temps qu'une prise", async () => {
    const { ledger } = setup();
    await ledger.take(counter, 3);

    await Promise.all([ledger.giveBack(counter), ledger.take(counter, 3), ledger.giveBack(counter)]);
    await expect(ledger.used(counter)).resolves.toBe(0);

    await ledger.giveBack(counter);
    await expect(ledger.used(counter)).resolves.toBe(0);
  });

  it('tient un compteur par personne, par rôle et par fenêtre', async () => {
    const { ledger } = setup();
    await ledger.take(counter, 1);

    await expect(ledger.take({ ...counter, ownerId: 'bob' }, 1)).resolves.toMatchObject({ taken: true });
    await expect(ledger.take({ ...counter, role: 'premium' }, 1)).resolves.toMatchObject({ taken: true });
    await expect(ledger.take({ ...counter, window: '2026-11' }, 1)).resolves.toMatchObject({ taken: true });
    await expect(ledger.take(counter, 1)).resolves.toEqual({ taken: false, used: 1 });
  });

  it("compte 0 pour un compteur qui n'a jamais servi, ou que quelqu'un aurait abîmé à la main", async () => {
    const { firestore, ledger } = setup();
    await expect(ledger.used(counter)).resolves.toBe(0);

    firestore.documents.set('usage-counters/alice|assistant.send-message|standard|lifetime', {
      version: 1,
      data: { used: 'trois' },
    });
    await expect(ledger.used(counter)).resolves.toBe(0);
    await expect(ledger.take(counter, 3)).resolves.toEqual({ taken: true, used: 1 });
  });
});
