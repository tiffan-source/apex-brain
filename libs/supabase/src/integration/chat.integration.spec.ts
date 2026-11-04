import { Objective } from '@org/objective';
import { SupabaseObjectiveRepository } from '../lib/objectives/repositories/objective.repository';
import { SupabaseGetAllMessagesQuery } from '../lib/chat/queries/get-conversation.query';
import { SupabaseAddMessageCommand } from '../lib/chat/commands/add-message.command';
import { SupabaseClientDataAccess } from '../lib/supabase-client';
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
  let access: SupabaseClientDataAccess;

  beforeAll(async () => {
    access = createIntegrationAccess();
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

  it("emporte la conversation et ses messages avec l'objectif", async () => {
    const objective = new Objective(testId('o'), 'À supprimer');
    await objectives.save(objective, alice);
    const conversation = await query.execute({ externalReferenceId: objective.id, ownerId: alice });
    if (!conversation) throw new Error('conversation attendue');
    const messageId = testId('m');
    await addMessage.execute({
      id: messageId,
      conversationId: conversation.id,
      userId: alice,
      message: 'Bonjour',
    });

    await expect(objectives.delete(objective.id, alice)).resolves.toBe(true);

    await expect(query.execute({ externalReferenceId: objective.id, ownerId: alice })).resolves.toBeNull();

    const db = access.clientInstance;
    await expect(db.from('messages').select('id').eq('id', messageId)).resolves.toMatchObject({ data: [] });
    await expect(db.from('conversations').select('id').eq('id', conversation.id)).resolves.toMatchObject({
      data: [],
    });
  });
});
