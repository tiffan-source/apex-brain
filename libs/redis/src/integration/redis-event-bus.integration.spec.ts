import type { BusEvent } from '@org/event-bus';
import { EventBusClosedError } from '@org/event-bus';
import { Redis } from 'ioredis';
import { RedisEventBus } from '../lib/redis-event-bus';
import { integrationEnabled, integrationRedisUrl, testChannel } from './redis-test-environment';

let sequence = 0;
const event = (type: string): BusEvent => ({
  id: `event-${++sequence}`,
  type,
  source: 'test',
  key: 'objective-1',
  ownerId: 'alice',
  audience: 'public',
  occurredAt: '2026-11-24T10:00:00.000Z',
  payload: { n: sequence },
});

/** Deux instances de l'API sur le même canal, et un client brut pour écrire sur le canal. */
async function twoInstances() {
  const channel = testChannel();
  const errors: string[] = [];
  const logger = { error: (message: string) => void errors.push(message) };
  const a = await RedisEventBus.connect({ url: integrationRedisUrl(), channel, logger });
  const b = await RedisEventBus.connect({ url: integrationRedisUrl(), channel, logger });
  const raw = new Redis(integrationRedisUrl());
  return { channel, errors, a, b, raw };
}

describe.skipIf(!integrationEnabled)('RedisEventBus (intégration)', () => {
  let opened: Awaited<ReturnType<typeof twoInstances>>[] = [];

  const open = async () => {
    const instances = await twoInstances();
    opened.push(instances);
    return instances;
  };

  afterEach(async () => {
    for (const { a, b, raw } of opened) {
      await Promise.all([a.close(), b.close()]);
      raw.disconnect();
    }
    opened = [];
  });

  it('remet un abonné `every-instance` sur chaque instance, une fois chacun, dans l’ordre', async () => {
    const { a, b } = await open();
    const onA: string[] = [];
    const onB: string[] = [];
    a.subscribe('*', (received) => void onA.push(received.id), { delivery: 'every-instance' });
    b.subscribe('*', (received) => void onB.push(received.id), { delivery: 'every-instance' });

    const published = Array.from({ length: 50 }, (_, index) => event(index % 2 ? 'turn' : 'state'));
    for (const sent of published) await a.publish(sent);

    const ids = published.map((sent) => sent.id);
    await vi.waitFor(() => expect(onB).toHaveLength(ids.length));
    await vi.waitFor(() => expect(onA).toHaveLength(ids.length));
    expect(onA).toEqual(ids);
    expect(onB).toEqual(ids);
  });

  it('remet un abonné `one-instance` sur la seule instance qui publie', async () => {
    const { a, b } = await open();
    const reactions: string[] = [];
    const followed: string[] = [];
    a.subscribe('turn', () => void reactions.push('a'));
    b.subscribe('turn', () => void reactions.push('b'));
    b.subscribe('turn', (received) => void followed.push(received.id), { delivery: 'every-instance' });

    const published = event('turn');
    await a.publish(published);

    // Quand l'événement est arrivé sur b par Redis, b a eu le temps de réagir s'il devait le faire.
    await vi.waitFor(() => expect(followed).toEqual([published.id]));
    await Promise.all([a.idle(), b.idle()]);
    expect(reactions).toEqual(['a']);
  });

  it('livre l’événement tel qu’il a été publié', async () => {
    const { a, b } = await open();
    const received: BusEvent[] = [];
    b.subscribe('turn', (delivered) => void received.push(delivered), { delivery: 'every-instance' });

    const published = event('turn');
    await a.publish(published);

    await vi.waitFor(() => expect(received).toEqual([published]));
  });

  it('ignore ce qui, sur le canal, n’est pas un événement, et continue', async () => {
    const { channel, errors, a, b, raw } = await open();
    const received: string[] = [];
    b.subscribe('*', (delivered) => void received.push(delivered.id), { delivery: 'every-instance' });

    await raw.publish(channel, 'pas un événement');
    const published = event('turn');
    await a.publish(published);

    await vi.waitFor(() => expect(received).toEqual([published.id]));
    expect(errors).toContain(`Ignored a message on ${channel} that is not an event`);
  });

  it('garde les réactions du serveur quand Redis ne prend plus les événements', async () => {
    const { a, b } = await open();
    const reactions: string[] = [];
    const followed: string[] = [];
    a.subscribe('turn', (received) => void reactions.push(received.id));
    b.subscribe('turn', (received) => void followed.push(received.id), { delivery: 'every-instance' });

    // La connexion de publication de a est coupée (et ne se rétablira pas).
    await a['publisher'].quit();
    const published = event('turn');
    await expect(a.publish(published)).rejects.toThrow();
    await a.idle();

    expect(reactions).toEqual([published.id]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(followed).toEqual([]);
  });

  it('ne livre plus rien une fois fermé, et refuse de publier', async () => {
    const { channel, a, b, raw } = await open();
    const received: string[] = [];
    b.subscribe('*', (delivered) => void received.push(delivered.id), { delivery: 'every-instance' });

    await b.close();
    await raw.publish(channel, JSON.stringify(event('turn')));
    await a.publish(event('turn'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(received).toEqual([]);
    await expect(b.publish(event('turn'))).rejects.toBeInstanceOf(EventBusClosedError);
    // Ses connexions sont fermées : Redis ne compte plus que l'abonnement de a sur le canal.
    await vi.waitFor(async () => expect(await raw.pubsub('NUMSUB', channel)).toEqual([channel, 1]));
  });
});
