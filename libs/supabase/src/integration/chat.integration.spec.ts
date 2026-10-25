import { Objective } from '@org/objective';
import { SupabaseObjectiveRepository } from '../lib/objectives/repositories/objective.repository';
import { SupabaseGetAllMessagesQuery } from '../lib/chat/queries/get-conversation.query';
import { SupabaseAddMessageCommand } from '../lib/chat/commands/add-message.command';
import {
  createIntegrationAccess,
  createTestUser,
  integrationEnabled,
  testId,
} from './supabase-test-environment';

describe.skipIf(!integrationEnabled)('Supabase — conversations (intégration)', () => {
  let alice: string;
  let mallory: string;
  let query: SupabaseGetAllMessagesQuery;
  let addMessage: SupabaseAddMessageCommand;
  let objectives: SupabaseObjectiveRepository;

  beforeAll(async () => {
    const access = createIntegrationAccess();
    query = new SupabaseGetAllMessagesQuery(access);
    addMessage = new SupabaseAddMessageCommand(access);
    objectives = new SupabaseObjectiveRepository(access);
    alice = (await createTestUser('alice')).id;
    mallory = (await createTestUser('mallory')).id;
  });

  it("trouve la conversation créée avec l'objectif, pour sa propriétaire seulement", async () => {
    const objective = new Objective(testId('o'), 'Avec conversation');
    await objectives.save(objective, alice);

    const conversation = await query.execute({ externalReferenceId: objective.id, ownerId: alice });

    expect(conversation).toEqual({ id: expect.any(String), messages: [] });
    await expect(query.execute({ externalReferenceId: objective.id, ownerId: mallory })).resolves.toBeNull();
    await expect(query.execute({ externalReferenceId: 'inconnu', ownerId: alice })).resolves.toBeNull();
  });

  it("ajoute des messages sans doublon, datés par la base, et les rend dans l'ordre", async () => {
    const objective = new Objective(testId('o'), 'Messages');
    await objectives.save(objective, alice);
    const conversation = await query.execute({
      externalReferenceId: objective.id,
      ownerId: alice,
      includeMessages: false,
    });
    if (!conversation) throw new Error('conversation attendue');

    const firstId = testId('m');
    const first = await addMessage.execute({
      id: firstId,
      conversationId: conversation.id,
      userId: alice,
      message: 'Bonjour',
    });
    const replayed = await addMessage.execute({
      id: firstId,
      conversationId: conversation.id,
      userId: alice,
      message: 'Bonjour',
    });
    await addMessage.execute({
      id: testId('m'),
      conversationId: conversation.id,
      userId: 'AI',
      message: 'Salut.',
    });

    expect(replayed).toEqual(first);
    expect(first.createdAt).toBeInstanceOf(Date);

    const loaded = await query.execute({ externalReferenceId: objective.id, ownerId: alice });
    expect(loaded?.messages.map(({ sender, content }) => ({ sender, content }))).toEqual([
      { sender: alice, content: 'Bonjour' },
      { sender: 'AI', content: 'Salut.' },
    ]);
  });
});
