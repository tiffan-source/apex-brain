import { UsagePolicy } from './models/usage-policy';
import { InMemoryUsageLedger } from './persistence/in-memory-usage-ledger';
import { InMemoryUsagePolicySource } from './testing/in-memory-usage-policy.source';
import { Reservation, UsageGate, UsagePerson } from './usage-gate';

const SEND = 'assistant.send-message';
const SELECT_MODEL = 'assistant.select-model';

const launchPolicies: UsagePolicy[] = [
  { action: SEND, role: 'standard', quota: 3, period: 'lifetime' },
  { action: SEND, role: 'premium', quota: null, period: 'lifetime' },
  { action: SEND, role: 'admin', quota: null, period: 'lifetime' },
];

const alice: UsagePerson = { id: 'alice', roles: ['standard'] };
const bob: UsagePerson = { id: 'bob', roles: ['standard'] };
const paula: UsagePerson = { id: 'paula', roles: ['premium'] };

function setup(policies: UsagePolicy[] = launchPolicies, now = new Date('2026-11-16T10:00:00Z')) {
  const source = new InMemoryUsagePolicySource(policies);
  const ledger = new InMemoryUsageLedger();
  const clock = { now };
  const gate = new UsageGate(source, ledger, () => clock.now);
  return { gate, source, ledger, clock };
}

const grantedCount = (reservations: Reservation[]) => reservations.filter((r) => r.granted).length;

describe('UsageGate', () => {
  describe('reserve', () => {
    it('prend une unité par action pour un compte standard, puis refuse au-delà du quota', async () => {
      const { gate } = setup();

      for (let i = 0; i < 3; i++) {
        await expect(gate.reserve(alice, SEND)).resolves.toMatchObject({ granted: true, counted: true });
      }

      await expect(gate.reserve(alice, SEND)).resolves.toEqual({
        granted: false,
        action: SEND,
        reason: 'quota-exceeded',
        quota: 3,
        used: 3,
        period: 'lifetime',
        resetsAt: null,
      });
    });

    it('compte chaque personne à part', async () => {
      const { gate } = setup();
      for (let i = 0; i < 3; i++) await gate.reserve(alice, SEND);

      await expect(gate.reserve(bob, SEND)).resolves.toMatchObject({ granted: true });
    });

    it('ne compte rien pour un compte sans limite, ni pour une action libre', async () => {
      const { gate, ledger } = setup();

      for (let i = 0; i < 10; i++) {
        await expect(gate.reserve(paula, SEND)).resolves.toMatchObject({ granted: true, counted: false });
        await expect(gate.reserve(alice, 'objective.create')).resolves.toMatchObject({
          granted: true,
          counted: false,
        });
      }
      expect(ledger.counts.size).toBe(0);
    });

    it("refuse une action gouvernée à qui n'a aucun des rôles nommés", async () => {
      const { gate } = setup([{ action: SELECT_MODEL, role: 'premium', quota: null, period: 'lifetime' }]);

      await expect(gate.reserve(alice, SELECT_MODEL)).resolves.toEqual({
        granted: false,
        action: SELECT_MODEL,
        reason: 'denied',
      });
      await expect(gate.reserve(paula, SELECT_MODEL)).resolves.toMatchObject({ granted: true });
    });

    it('rend une unité à la libération, une seule fois même si on libère deux fois', async () => {
      const { gate } = setup();
      await gate.reserve(alice, SEND);
      const second = await gate.reserve(alice, SEND);
      const third = await gate.reserve(alice, SEND);
      if (!second.granted || !third.granted) throw new Error('réservations attendues');

      await third.release();
      await third.release();

      await expect(gate.usageOf(alice)).resolves.toEqual([
        expect.objectContaining({ action: SEND, used: 2, remaining: 1 }),
      ]);
    });

    it('ne dépasse jamais le quota, même quand toutes les demandes arrivent en même temps', async () => {
      const { gate } = setup();

      const reservations = await Promise.all(Array.from({ length: 10 }, () => gate.reserve(alice, SEND)));

      expect(grantedCount(reservations)).toBe(3);
    });

    it('applique une politique changée dès la décision suivante', async () => {
      const { gate, source } = setup();
      for (let i = 0; i < 3; i++) await gate.reserve(alice, SEND);

      source.set({ action: SEND, role: 'standard', quota: 5, period: 'lifetime' });
      await expect(gate.reserve(alice, SEND)).resolves.toMatchObject({ granted: true });

      // Premium limité à son tour : on ne comptait rien jusque-là, chacun part de zéro.
      source.set({ action: SEND, role: 'premium', quota: 1, period: 'lifetime' });
      await expect(gate.reserve(paula, SEND)).resolves.toMatchObject({ granted: true, counted: true });
      await expect(gate.reserve(paula, SEND)).resolves.toMatchObject({ granted: false, used: 1 });

      // Débranchée : plus aucune limite.
      source.removeAction(SEND);
      await expect(gate.reserve(paula, SEND)).resolves.toMatchObject({ granted: true, counted: false });
    });

    it('repart de zéro à chaque nouvelle période, et dit quand', async () => {
      const { gate, clock } = setup([{ action: SEND, role: 'standard', quota: 1, period: 'month' }]);

      await gate.reserve(alice, SEND);
      await expect(gate.reserve(alice, SEND)).resolves.toMatchObject({
        granted: false,
        resetsAt: new Date('2026-12-01T00:00:00Z'),
      });

      clock.now = new Date('2026-12-01T00:00:00Z');
      await expect(gate.reserve(alice, SEND)).resolves.toMatchObject({ granted: true });
    });

    it('garde un compteur par rôle : redevenir standard ne rend pas les essais', async () => {
      const { gate, ledger } = setup([
        { action: SEND, role: 'standard', quota: 3, period: 'lifetime' },
        { action: SEND, role: 'premium', quota: 10, period: 'lifetime' },
      ]);
      for (let i = 0; i < 3; i++) await gate.reserve(alice, SEND);

      const upgraded = { ...alice, roles: ['premium'] as const };
      await expect(gate.reserve(upgraded, SEND)).resolves.toMatchObject({ granted: true });
      await expect(gate.reserve(alice, SEND)).resolves.toMatchObject({ granted: false, used: 3 });

      const counterOf = (role: 'standard' | 'premium') => ({
        ownerId: 'alice',
        action: SEND,
        role,
        window: 'lifetime',
      });
      await expect(ledger.used(counterOf('standard'))).resolves.toBe(3);
      await expect(ledger.used(counterOf('premium'))).resolves.toBe(1);
      expect(ledger.counts.size).toBe(2);
    });
  });

  describe('usageOf', () => {
    it("décrit chaque action gouvernée : ce qu'il reste à un compte standard, et ce qui lui est fermé", async () => {
      const { gate } = setup([
        ...launchPolicies,
        { action: SELECT_MODEL, role: 'premium', quota: null, period: 'lifetime' },
      ]);
      await gate.reserve(alice, SEND);

      await expect(gate.usageOf(alice)).resolves.toEqual([
        { action: SELECT_MODEL, access: 'denied' },
        {
          action: SEND,
          access: 'limited',
          quota: 3,
          used: 1,
          remaining: 2,
          period: 'lifetime',
          resetsAt: null,
        },
      ]);
      await expect(gate.usageOf(paula)).resolves.toEqual([
        { action: SELECT_MODEL, access: 'unlimited' },
        { action: SEND, access: 'unlimited' },
      ]);
    });

    it("ne rend rien quand aucune politique n'est en vigueur", async () => {
      await expect(setup([]).gate.usageOf(alice)).resolves.toEqual([]);
    });

    it('ne rend jamais un reste négatif quand le quota baisse sous ce qui est déjà utilisé', async () => {
      const { gate, source } = setup();
      for (let i = 0; i < 3; i++) await gate.reserve(alice, SEND);

      source.set({ action: SEND, role: 'standard', quota: 1, period: 'lifetime' });

      await expect(gate.usageOf(alice)).resolves.toEqual([
        expect.objectContaining({ quota: 1, used: 3, remaining: 0 }),
      ]);
    });
  });
});
