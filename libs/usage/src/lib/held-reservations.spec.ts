import { heldReservationKey, HeldReservations } from './held-reservations';
import { GrantedReservation } from './usage-gate';

function reservation() {
  const released = { count: 0 };
  const value: GrantedReservation = {
    granted: true,
    action: 'assistant.send-message',
    counted: true,
    release: async () => {
      released.count += 1;
    },
  };
  return { value, released };
}

const key = heldReservationKey('assistant.send-message', 'alice', 'o1');

describe('HeldReservations', () => {
  it("garde l'unité d'une action réussie, rend celle d'une action en panne", async () => {
    const held = new HeldReservations();
    const succeeded = reservation();
    const failed = reservation();

    held.hold(key, succeeded.value);
    await held.settle(key, 'succeeded');
    held.hold(key, failed.value);
    await held.settle(key, 'failed');

    expect(succeeded.released.count).toBe(0);
    expect(failed.released.count).toBe(1);
    expect(held.size).toBe(0);
  });

  it("règle les réservations d'une même clé dans leur ordre d'arrivée", async () => {
    const held = new HeldReservations();
    const first = reservation();
    const second = reservation();
    held.hold(key, first.value);
    held.hold(key, second.value);

    await held.settle(key, 'failed');

    expect(first.released.count).toBe(1);
    expect(second.released.count).toBe(0);
    expect(held.size).toBe(1);
  });

  it("ne mélange pas les clés : l'issue d'un tour ne règle que ce tour", async () => {
    const held = new HeldReservations();
    const alice = reservation();
    const bob = reservation();
    held.hold(key, alice.value);
    held.hold(heldReservationKey('assistant.send-message', 'bob', 'o1'), bob.value);

    await held.settle(heldReservationKey('assistant.send-message', 'bob', 'o1'), 'failed');

    expect(alice.released.count).toBe(0);
    expect(bob.released.count).toBe(1);
  });

  it("ne fait rien quand rien n'est tenu (compte sans limite, tour commencé avant un redémarrage)", async () => {
    await expect(new HeldReservations().settle(key, 'failed')).resolves.toBeUndefined();
  });

  it('retire une réservation précise, sans toucher aux autres', async () => {
    const held = new HeldReservations();
    const kept = reservation();
    const dropped = reservation();
    held.hold(key, kept.value);
    held.hold(key, dropped.value);

    held.drop(key, dropped.value);
    held.drop(key, dropped.value);
    await held.settle(key, 'failed');

    expect(kept.released.count).toBe(1);
    expect(dropped.released.count).toBe(0);
    expect(held.size).toBe(0);
  });

  it('oublie une réservation tenue trop longtemps : son unité reste consommée', async () => {
    const clock = { now: 0 };
    const held = new HeldReservations({ maxAgeMs: 1_000, now: () => clock.now });
    const stale = reservation();
    const fresh = reservation();

    held.hold(key, stale.value);
    clock.now = 1_500;
    held.hold(heldReservationKey('assistant.send-message', 'alice', 'o2'), fresh.value);

    expect(held.size).toBe(1);
    await held.settle(key, 'failed');
    expect(stale.released.count).toBe(0);
  });

  it('forme des clés sans collision, quel que soit le contenu des parties', () => {
    expect(heldReservationKey('a', 'b:c', 'd')).not.toBe(heldReservationKey('a', 'b', 'c:d'));
  });
});
