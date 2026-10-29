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
      .post('/v1/objectives')
      .set('Authorization', alice.authorization)
      .send({ title: 'Courir un marathon' });
    objectiveId = created.body.id;
  });

  afterEach(() => t.close());

  const state = async (who = alice) => {
    const response = await t
      .http()
      .get(`/v1/objectives/${objectiveId}/assistant`)
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
      .post(`/v1/objectives/${objectiveId}/assistant/messages`)
      .set('Authorization', who.authorization)
      .send({ message });

  it("ouvre la conversation de l'objectif, vide au départ (GetConversationsQuery)", async () => {
    const response = await t
      .http()
      .get(`/v1/objectives/${objectiveId}/conversation`)
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
          .get(`/v1/objectives/${objectiveId}/conversation`)
          .set('Authorization', alice.authorization)
      ).body,
    );
    expect(conversation.messages.map(({ sender, content }) => ({ sender, content }))).toEqual([
      { sender: alice.id, content: 'Par où commencer ?' },
      { sender: 'AI', content: 'Commence par 20 minutes de course.' },
    ]);
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

    await send('Ajoute un premier pas');
    const waiting = await waitFor('awaiting-permission');
    expect(waiting.pendingToolCall).toMatchObject({ id: 'call-1', name: 'createTask' });

    const stale = await t
      .http()
      .post(`/v1/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({ granted: true, toolCallId: 'call-ancien' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('NO_PENDING_PERMISSION');

    const busy = await send('Et sinon ?');
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('WORKFLOW_BUSY');

    const granted = await t
      .http()
      .post(`/v1/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({ granted: true, toolCallId: 'call-1' });
    expect(granted.status).toBe(202);

    await waitFor('ready');
    const objectives = await t.http().get('/v1/objectives').set('Authorization', alice.authorization);
    expect(objectives.body.tasks).toEqual([
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
      .post(`/v1/objectives/${objectiveId}/sub-objectives`)
      .set('Authorization', alice.authorization)
      .send({ title: 'Étape' });

    const attempts = [
      t.http().get(`/v1/objectives/${objectiveId}/conversation`).set('Authorization', mallory.authorization),
      t.http().get(`/v1/objectives/${objectiveId}/assistant`).set('Authorization', mallory.authorization),
      send('Coucou', mallory),
      t
        .http()
        .post(`/v1/objectives/${objectiveId}/assistant/permission`)
        .set('Authorization', mallory.authorization)
        .send({ granted: true }),
      // Une étape n'a pas de conversation : seul l'objectif principal en a une.
      t.http().get(`/v1/objectives/${stage.body.id}/conversation`).set('Authorization', alice.authorization),
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CONVERSATION_NOT_FOUND');
    }
  });

  it('valide le message et la réponse à une demande', async () => {
    const empty = await send('   ');
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const noDecision = await t
      .http()
      .post(`/v1/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({});
    expect(noDecision.status).toBe(400);

    const nothingPending = await t
      .http()
      .post(`/v1/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({ granted: false });
    expect(nothingPending.status).toBe(409);
  });
});
