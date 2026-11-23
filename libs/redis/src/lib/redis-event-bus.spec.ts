import { RedisEventBus } from './redis-event-bus';

describe('RedisEventBus — sans Redis', () => {
  it('refuse de démarrer, avec la raison, quand Redis ne répond pas', async () => {
    const errors: unknown[] = [];
    const startedAt = Date.now();

    // Le port 1 refuse toute connexion : pas besoin de Redis pour ce test.
    const connecting = RedisEventBus.connect({
      url: 'redis://127.0.0.1:1',
      channel: 'apex-brain:test',
      logger: { error: (_message, error) => errors.push(error) },
    });

    await expect(connecting).rejects.toThrow(/Redis is unreachable: .*ECONNREFUSED/);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    // Rien à journaliser : le démarrage échoue, il ne se reconnecte pas en boucle.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(errors).toEqual([]);
  });
});
