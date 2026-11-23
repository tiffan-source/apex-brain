import { BusEvent } from './bus-event';
import { InMemoryEventBus } from './in-memory-event-bus';

let sequence = 0;
const event = (type: string, payload: Record<string, unknown> = {}): BusEvent => ({
  id: `event-${++sequence}`,
  type,
  source: 'test',
  key: 'k',
  ownerId: 'alice',
  audience: 'internal',
  occurredAt: '2026-11-23T10:00:00.000Z',
  payload,
});

const silent = () => {
  const errors: unknown[] = [];
  return { errors, logger: { error: (_message: string, error?: unknown) => errors.push(error) } };
};

describe('InMemoryEventBus', () => {
  it('livre à chaque abonné les événements de son type, ou tous avec *, dans leur ordre', async () => {
    const bus = new InMemoryEventBus(silent().logger);
    const typed: string[] = [];
    const all: string[] = [];
    bus.subscribe('a', (received) => void typed.push(received.id));
    bus.subscribe('*', (received) => void all.push(received.id));

    const [first, second, third] = [event('a'), event('b'), event('a')];
    for (const published of [first, second, third]) await bus.publish(published);
    await bus.idle();

    expect(typed).toEqual([first.id, third.id]);
    expect(all).toEqual([first.id, second.id, third.id]);
  });

  it('ne livre jamais dans la pile de celui qui publie', async () => {
    const bus = new InMemoryEventBus(silent().logger);
    const received: string[] = [];
    bus.subscribe('a', (delivered) => void received.push(delivered.id));

    const published = bus.publish(event('a'));
    expect(received).toEqual([]);

    await published;
    await bus.idle();
    expect(received).toHaveLength(1);
  });

  it('garde l’ordre pour un abonné lent, sans retenir les autres', async () => {
    const bus = new InMemoryEventBus(silent().logger);
    const slow: string[] = [];
    const fast: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    bus.subscribe('a', async (delivered) => {
      if (slow.length === 0) await gate;
      slow.push(delivered.id);
    });
    bus.subscribe('a', (delivered) => void fast.push(delivered.id));

    const [first, second] = [event('a'), event('a')];
    await bus.publish(first);
    await bus.publish(second);
    await vi.waitFor(() => expect(fast).toEqual([first.id, second.id]));
    expect(slow).toEqual([]);

    release();
    await bus.idle();
    expect(slow).toEqual([first.id, second.id]);
  });

  it("journalise l'erreur d'un abonné, qu'il lance ou qu'il rejette, sans gêner les autres", async () => {
    const { errors, logger } = silent();
    const bus = new InMemoryEventBus(logger);
    const thrown = new Error('lancée');
    const rejected = new Error('rejetée');
    const received: string[] = [];
    bus.subscribe('a', () => {
      throw thrown;
    });
    bus.subscribe('a', async () => {
      throw rejected;
    });
    bus.subscribe('a', (delivered) => void received.push(delivered.id));

    const published = event('a');
    await expect(bus.publish(published)).resolves.toBeUndefined();
    await bus.idle();

    expect(received).toEqual([published.id]);
    expect(errors).toEqual([thrown, rejected]);
  });

  it("n'envoie plus rien à un abonné qui s'est désabonné, même déjà en file", async () => {
    const bus = new InMemoryEventBus(silent().logger);
    const received: string[] = [];
    const subscription = bus.subscribe('a', (delivered) => void received.push(delivered.id));

    // Publié, en file, mais pas encore livré : le désabonnement passe avant.
    const queued = bus.publish(event('a'));
    subscription.unsubscribe();
    await queued;
    await bus.publish(event('a'));
    await bus.idle();

    expect(received).toEqual([]);
    expect(bus.subscriberCount).toBe(0);
  });
});
