import { Logger } from '@nestjs/common';
import { AIProviderError } from '@org/ai';
import { conversationResponseSchema } from '../src/conversation/conversation.schemas';
import { workflowStateResponseSchema } from '../src/assistant/assistant.schemas';
import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

describe('Conversation et assistant (e2e)', () => {
  let t: TestApp;
  let alice: ReturnType<TestApp['signIn']>;
  let mallory: ReturnType<TestApp['signIn']>;
  let objectiveId: string;

  beforeEach(async () => {
    t = await createTestApp();
    alice = t.signIn('alice@apex.test');
    mallory = t.signIn('mallory@apex.test');
    const created = await t
      .http()
      .post('/v2/objectives')
      .set('Authorization', alice.authorization)
      .send({ title: 'Courir un marathon' });
    objectiveId = created.body.id;
  });

  afterEach(() => t.close());

  const state = async (who = alice) => {
    const response = await t
      .http()
      .get(`/v2/objectives/${objectiveId}/assistant`)
      .set('Authorization', who.authorization);
    expect(response.status).toBe(200);
    return workflowStateResponseSchema.parse(response.body);
  };

  /** Interroger l'état comme le client, jusqu'au statut attendu. */
  const waitFor = async (status: 'ready' | 'awaiting-permission') => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const current = await state();
      if (current.status === status) return current;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`statut « ${status} » jamais atteint`);
  };

  const send = (message: string, who = alice) =>
    t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/messages`)
      .set('Authorization', who.authorization)
      .send({ message });

  it("ouvre la conversation de l'objectif, vide au départ (GetConversationsQuery)", async () => {
    const response = await t
      .http()
      .get(`/v2/objectives/${objectiveId}/conversation`)
      .set('Authorization', alice.authorization);

    expect(response.status).toBe(200);
    expect(conversationResponseSchema.parse(response.body)).toEqual({ id: expect.any(String), messages: [] });
    await expect(state()).resolves.toMatchObject({
      status: 'ready',
      value: 'Ready For New Message',
      lastRegisteredMessage: null,
    });
  });

  it("mène un tour complet : message, réponse d'Akari, historique", async () => {
    t.ai.willRespond(t.ai.text('Commence par 20 minutes de course.'));

    const accepted = await send('Par où commencer ?');
    expect(accepted.status).toBe(202);
    expect(workflowStateResponseSchema.parse(accepted.body).status).toBe('processing');

    const done = await waitFor('ready');
    expect(done.lastRegisteredMessage).toMatchObject({
      sender: 'AI',
      content: 'Commence par 20 minutes de course.',
    });

    const conversation = conversationResponseSchema.parse(
      (
        await t
          .http()
          .get(`/v2/objectives/${objectiveId}/conversation`)
          .set('Authorization', alice.authorization)
      ).body,
    );
    expect(conversation.messages.map(({ sender, content }) => ({ sender, content }))).toEqual([
      { sender: alice.id, content: 'Par où commencer ?' },
      { sender: 'AI', content: 'Commence par 20 minutes de course.' },
    ]);
  });

  it("dit ce que fait Akari pendant un tour, sans nommer ni l'outil ni le modèle", async () => {
    let answer: (response: ReturnType<typeof t.ai.text>) => void = () => undefined;
    t.ai.willRespond(
      t.ai.toolCalls({ id: 'call-1', name: 'getObjectiveTree', arguments: { id: objectiveId } }),
      () => new Promise((resolve) => (answer = resolve)),
    );

    const accepted = await send('Où en suis-je ?');
    expect(workflowStateResponseSchema.parse(accepted.body).activity).toMatchObject({
      step: 'saving-message',
      round: 0,
      done: [],
    });

    await vi.waitFor(() => expect(t.ai.calls).toHaveLength(2));
    const reviewing = await state();
    expect(reviewing.activity).toEqual({
      step: 'reviewing',
      elapsedMs: expect.any(Number),
      round: 2,
      done: ['saving-message', 'thinking', 'checking-permission', 'reading'],
    });
    expect(JSON.stringify(reviewing.activity)).not.toMatch(/getObjectiveTree|gemini/i);

    answer(t.ai.text('Ton objectif est vide.'));
    await expect(waitFor('ready')).resolves.toMatchObject({ activity: null });
  });

  it("demande l'accord avant d'ajouter un pas, puis l'ajoute pour la personne", async () => {
    t.ai.willRespond(
      t.ai.toolCalls({
        id: 'call-1',
        name: 'createTask',
        arguments: { objectiveId, title: 'Courir 5 km', importance: 4, urgency: 2 },
      }),
      t.ai.text("C'est ajouté."),
    );

    await send('Ajoute un pas');
    const waiting = await waitFor('awaiting-permission');
    expect(waiting.pendingToolCall).toMatchObject({ id: 'call-1', name: 'createTask' });

    const stale = await t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({ granted: true, toolCallId: 'call-ancien' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('NO_PENDING_PERMISSION');

    const busy = await send('Et sinon ?');
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('WORKFLOW_BUSY');

    const granted = await t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({ granted: true, toolCallId: 'call-1' });
    expect(granted.status).toBe(202);

    await waitFor('ready');
    expect([...t.objectives.db.tasks.values()]).toEqual([
      expect.objectContaining({ title: 'Courir 5 km', objectiveId, importance: 4, urgency: 2, done: false }),
    ]);
  });

  it("signale la panne d'Akari dans l'état, et accepte un nouveau message", async () => {
    const logged = vi.spyOn(Logger.prototype, 'error');
    t.ai.willRespond(new AIProviderError('quota'), t.ai.text('Me revoilà.'));

    await send('Bonjour');
    const failed = await waitFor('ready');
    expect(failed.lastError).toEqual({
      code: 'AI_PROVIDER_FAILURE',
      step: 'SendingPromptToAI',
      at: expect.any(String),
    });
    // Journalisée en une seule entrée, avec son détail : plus de ligne « undefined » à sa suite.
    expect(logged).toHaveBeenCalledWith(
      `Workflow ${objectiveId}: AI_PROVIDER_FAILURE during SendingPromptToAI: quota`,
    );
    logged.mockRestore();

    await send('Tu es là ?');
    const recovered = await waitFor('ready');
    expect(recovered.lastError).toBeNull();
  });

  it("n'ouvre la conversation et l'assistant qu'à la propriétaire de l'objectif principal", async () => {
    const stage = await t
      .http()
      .post(`/v2/objectives/${objectiveId}/sub-objectives`)
      .set('Authorization', alice.authorization)
      .send({ title: 'Étape' });

    const attempts = [
      t.http().get(`/v2/objectives/${objectiveId}/conversation`).set('Authorization', mallory.authorization),
      t.http().get(`/v2/objectives/${objectiveId}/assistant`).set('Authorization', mallory.authorization),
      send('Coucou', mallory),
      t
        .http()
        .post(`/v2/objectives/${objectiveId}/assistant/permission`)
        .set('Authorization', mallory.authorization)
        .send({ granted: true }),
      // Une étape n'a pas de conversation : seul l'objectif principal en a une.
      t.http().get(`/v2/objectives/${stage.body.id}/conversation`).set('Authorization', alice.authorization),
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CONVERSATION_NOT_FOUND');
    }
  });

  describe("suppression de l'objectif", () => {
    const remove = (id = objectiveId) =>
      t.http().delete(`/v2/objectives/${id}`).set('Authorization', alice.authorization);

    it("emporte la conversation et met fin à l'assistant, même quand il attend un accord", async () => {
      t.ai.willRespond(
        t.ai.toolCalls({
          id: 'call-1',
          name: 'createTask',
          arguments: { objectiveId, title: 'Courir 5 km', importance: 4, urgency: 2 },
        }),
      );
      await send('Ajoute un premier pas');
      await waitFor('awaiting-permission');
      await expect(t.workflowStates.findById(objectiveId)).resolves.not.toBeNull();
      expect(t.chat.db.messages.size).toBe(1);

      expect((await remove()).status).toBe(204);

      expect(t.chat.db.conversations.size).toBe(0);
      expect(t.chat.db.messages.size).toBe(0);
      await expect(t.workflowStates.findById(objectiveId)).resolves.toBeNull();

      const afterwards = await Promise.all([
        t.http().get(`/v2/objectives/${objectiveId}/conversation`).set('Authorization', alice.authorization),
        t.http().get(`/v2/objectives/${objectiveId}/assistant`).set('Authorization', alice.authorization),
        send('Tu es encore là ?'),
        t
          .http()
          .post(`/v2/objectives/${objectiveId}/assistant/permission`)
          .set('Authorization', alice.authorization)
          .send({ granted: true, toolCallId: 'call-1' }),
      ]);

      for (const response of afterwards) {
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('CONVERSATION_NOT_FOUND');
      }
      expect(t.objectives.db.tasks.size).toBe(0);
    });

    it("garde la conversation et l'assistant de l'objectif quand on supprime une de ses étapes", async () => {
      const stage = await t
        .http()
        .post(`/v2/objectives/${objectiveId}/sub-objectives`)
        .set('Authorization', alice.authorization)
        .send({ title: 'Préparer le corps' });
      t.ai.willRespond(t.ai.text('Commence doucement.'));
      await send('Par où commencer ?');
      await waitFor('ready');

      expect((await remove(stage.body.id)).status).toBe(204);

      expect(t.chat.db.messages.size).toBe(2);
      await expect(state()).resolves.toMatchObject({
        status: 'ready',
        lastRegisteredMessage: { content: 'Commence doucement.' },
      });
    });

    it("n'arrête pas l'assistant d'Alice quand Mallory tente la suppression", async () => {
      t.ai.willRespond(t.ai.text('Commence doucement.'));
      await send('Par où commencer ?');
      await waitFor('ready');

      const stolen = await t
        .http()
        .delete(`/v2/objectives/${objectiveId}`)
        .set('Authorization', mallory.authorization);

      expect(stolen.status).toBe(404);
      await expect(state()).resolves.toMatchObject({ status: 'ready' });
      await expect(t.workflowStates.findById(objectiveId)).resolves.not.toBeNull();
    });

    it("répond 204 quand l'état de l'assistant ne peut pas être effacé : l'objectif est déjà supprimé", async () => {
      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      vi.spyOn(t.workflowStates, 'delete').mockRejectedValueOnce(new Error('Firestore indisponible'));

      const response = await remove();

      expect(response.status).toBe(204);
      expect(t.objectives.db.objectives.has(objectiveId)).toBe(false);
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('could not be deleted'),
        expect.stringContaining('Firestore indisponible'),
      );
    });
  });

  it('valide le message et la réponse à une demande', async () => {
    const empty = await send('   ');
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const noDecision = await t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({});
    expect(noDecision.status).toBe(400);

    const nothingPending = await t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({ granted: false });
    expect(nothingPending.status).toBe(409);
  });
});
