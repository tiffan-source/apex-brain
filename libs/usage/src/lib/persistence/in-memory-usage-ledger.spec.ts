import { UsageCounter, usageCounterId } from '../protocols/usage-ledger';
import { InMemoryUsageLedger } from './in-memory-usage-ledger';

const counter: UsageCounter = {
  ownerId: 'alice',
  action: 'assistant.send-message',
  role: 'standard',
  window: 'lifetime',
};

describe('InMemoryUsageLedger', () => {
  it('prend une unité tant que le compteur est sous la limite, et rend le compte', async () => {
    const ledger = new InMemoryUsageLedger();

    await expect(ledger.take(counter, 2)).resolves.toEqual({ taken: true, used: 1 });
    await expect(ledger.take(counter, 2)).resolves.toEqual({ taken: true, used: 2 });
    await expect(ledger.take(counter, 2)).resolves.toEqual({ taken: false, used: 2 });
    await expect(ledger.used(counter)).resolves.toBe(2);
  });

  it('rend une unité sans jamais descendre sous zéro', async () => {
    const ledger = new InMemoryUsageLedger();
    await ledger.take(counter, 3);

    await ledger.giveBack(counter);
    await ledger.giveBack(counter);

    await expect(ledger.used(counter)).resolves.toBe(0);
  });

  it('refuse tout avec un quota de 0', async () => {
    await expect(new InMemoryUsageLedger().take(counter, 0)).resolves.toEqual({ taken: false, used: 0 });
  });
});

describe('usageCounterId', () => {
  it('rend un id utilisable par Firestore, sans confusion entre les parties', () => {
    expect(usageCounterId(counter)).toBe('alice|assistant.send-message|standard|lifetime');
    expect(usageCounterId({ ...counter, ownerId: 'a/b|c' })).toBe(
      'a%2Fb%7Cc|assistant.send-message|standard|lifetime',
    );
  });
});
