import { InMemoryAkariUsageJournal } from './in-memory-akari-usage-journal';

describe("Journal d'usage d'Akari (en mémoire)", () => {
  const at = new Date('2027-01-15T10:00:00.000Z');

  it("ne compte qu'une fois un tour rejoué sous le même id de réponse", async () => {
    const journal = new InMemoryAkariUsageJournal();

    await journal.record('reply-1', { ownerId: 'alice', objectiveId: 'o1', at });
    await journal.record('reply-1', { ownerId: 'alice', objectiveId: 'o1', at: new Date('2027-01-16') });

    await expect(journal.countSince('alice', null)).resolves.toBe(1);
  });

  it("compte les tours d'une seule personne, depuis le début de la fenêtre", async () => {
    const journal = new InMemoryAkariUsageJournal();
    await journal.record('r1', { ownerId: 'alice', objectiveId: 'o1', at: new Date('2027-01-14T23:59:59Z') });
    await journal.record('r2', { ownerId: 'alice', objectiveId: 'o2', at });
    await journal.record('r3', { ownerId: 'bob', objectiveId: 'o3', at });

    await expect(journal.countSince('alice', null)).resolves.toBe(2);
    await expect(journal.countSince('alice', new Date('2027-01-15T00:00:00Z'))).resolves.toBe(1);
  });
});
