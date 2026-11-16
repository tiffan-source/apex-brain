import type { InteractionHistory } from '@org/ai';
import { FakeFirestore } from '../testing/fake-firestore';
import { FirebaseInteractionHistoryRepository } from './firebase-interaction-history.repository';

const history: InteractionHistory = {
  interactionId: 'msg_1',
  provider: 'claude',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Range ma semaine' }] },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'createTask',
          input: {
            matrix: [
              [1, 2],
              [3, 4],
            ],
          },
        },
      ],
    },
  ],
  createdAt: '2026-11-12T10:00:00.000Z',
};

describe('FirebaseInteractionHistoryRepository', () => {
  it('enregistre et relit un historique, même avec des tableaux imbriqués dans les messages', async () => {
    const firestore = new FakeFirestore();
    const repository = new FirebaseInteractionHistoryRepository({ db: firestore });

    await repository.save(history);

    await expect(repository.findById('msg_1')).resolves.toEqual(history);
    expect(firestore.documents.get('ai-interaction-histories/msg_1')).toMatchObject({
      schemaVersion: 1,
      provider: 'claude',
      createdAt: '2026-11-12T10:00:00.000Z',
    });
  });

  it('rend null pour une interaction inconnue', async () => {
    await expect(
      new FirebaseInteractionHistoryRepository({ db: new FakeFirestore() }).findById('inconnue'),
    ).resolves.toBeNull();
  });
});
