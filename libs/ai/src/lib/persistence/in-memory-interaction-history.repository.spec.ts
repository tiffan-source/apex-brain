import { InMemoryInteractionHistoryRepository } from './in-memory-interaction-history.repository';

describe('InMemoryInteractionHistoryRepository', () => {
  it('relit une copie de ce qui a été enregistré, jamais la même référence', async () => {
    const repository = new InMemoryInteractionHistoryRepository();
    const history = {
      interactionId: 'msg_1',
      provider: 'claude',
      messages: [{ role: 'user', content: 'Salut' }],
      createdAt: '2026-11-12T10:00:00.000Z',
    };

    await repository.save(history);
    history.messages.push({ role: 'assistant', content: 'modifié après coup' });

    await expect(repository.findById('msg_1')).resolves.toEqual({
      interactionId: 'msg_1',
      provider: 'claude',
      messages: [{ role: 'user', content: 'Salut' }],
      createdAt: '2026-11-12T10:00:00.000Z',
    });
  });

  it('rend null pour une interaction inconnue', async () => {
    await expect(new InMemoryInteractionHistoryRepository().findById('inconnue')).resolves.toBeNull();
  });
});
