import { BusEvent } from '../bus-event';
import { EventBusClosedError } from '../event-bus';
import { InMemoryEventBusCluster } from './in-memory-event-bus-cluster';

let sequence = 0;
const event = (type: string): BusEvent => ({
  id: `event-${++sequence}`,
  type,
  source: 'test',
  key: 'k',
  ownerId: 'alice',
  audience: 'public',
  occurredAt: '2026-11-24T10:00:00.000Z',
  payload: { n: sequence },
});

const silent = { error: () => undefined };

describe('InMemoryEventBusCluster', () => {
  it('livre un abonné `one-instance` sur la seule instance qui publie', async () => {
    const cluster = new InMemoryEventBusCluster();
    const [a, b] = [cluster.instance(silent), cluster.instance(silent)];
    const received: string[] = [];
    a.subscribe('t', () => void received.push('a'));
    b.subscribe('t', () => void received.push('b'));

    await a.publish(event('t'));
    await cluster.idle();

    expect(received).toEqual(['a']);
  });

  it('livre un abonné `every-instance` sur chaque instance, une fois, dans l’ordre', async () => {
    const cluster = new InMemoryEventBusCluster();
    const [a, b] = [cluster.instance(silent), cluster.instance(silent)];
    const onA: string[] = [];
    const onB: string[] = [];
    a.subscribe('*', (received) => void onA.push(received.id), { delivery: 'every-instance' });
    b.subscribe('*', (received) => void onB.push(received.id), { delivery: 'every-instance' });

    const published = [event('t'), event('u'), event('t')];
    for (const sent of published) await a.publish(sent);
    await cluster.idle();

    const ids = published.map((sent) => sent.id);
    expect(onA).toEqual(ids);
    expect(onB).toEqual(ids);
  });

  it('remet une copie, comme un bus distant', async () => {
    const cluster = new InMemoryEventBusCluster();
    const [a, b] = [cluster.instance(silent), cluster.instance(silent)];
    const received: BusEvent[] = [];
    b.subscribe('t', (delivered) => void received.push(delivered), { delivery: 'every-instance' });

    const published = event('t');
    await a.publish(published);
    await cluster.idle();

    expect(received).toEqual([published]);
    expect(received[0]).not.toBe(published);
  });

  it('ne livre plus rien à une instance fermée, qui refuse de publier', async () => {
    const cluster = new InMemoryEventBusCluster();
    const [a, b] = [cluster.instance(silent), cluster.instance(silent)];
    const onB: string[] = [];
    b.subscribe('t', (delivered) => void onB.push(delivered.id), { delivery: 'every-instance' });

    await b.close();
    await a.publish(event('t'));
    await cluster.idle();

    expect(onB).toEqual([]);
    await expect(b.publish(event('t'))).rejects.toBeInstanceOf(EventBusClosedError);
  });
});
