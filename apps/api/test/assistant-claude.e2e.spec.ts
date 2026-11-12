import { InMemoryInteractionHistoryRepository } from '@org/ai';
import type { ClaudeCreateMessageParams, ClaudeMessage, ClaudeMessagesClient } from '@org/claude';
import { ClaudeInteractiveAIProvider } from '@org/claude';
import { workflowStateResponseSchema } from '../src/assistant/assistant.schemas';
import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

/** L'API Messages simulée : des réponses écrites à l'avance, et chaque requête reçue. */
class FakeMessagesClient implements ClaudeMessagesClient {
  readonly requests: ClaudeCreateMessageParams[] = [];
  readonly replies: ClaudeMessage[] = [];

  async create(params: ClaudeCreateMessageParams): Promise<ClaudeMessage> {
    this.requests.push(structuredClone(params));
    const reply = this.replies.shift();
    if (!reply) throw new Error('FakeMessagesClient : plus aucune réponse prévue');
    return reply;
  }
}

const text = (id: string, content: string): ClaudeMessage => ({
  id,
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: content, citations: null }],
});

/**
 * Akari sur l'adaptateur Claude (le SDK seul est simulé) : le workflow, les outils et l'accord de la
 * personne enchaînent les interactions de Claude par leurs ids, l'historique suit.
 */
describe('Assistant sur Claude (e2e, API Messages simulée)', () => {
  let t: TestApp;
  let claude: FakeMessagesClient;
  let alice: ReturnType<TestApp['signIn']>;
  let objectiveId: string;

  beforeEach(async () => {
    claude = new FakeMessagesClient();
    t = await createTestApp(
      {},
      {
        aiProvider: new ClaudeInteractiveAIProvider(claude, new InMemoryInteractionHistoryRepository(), {
          model: 'claude-sonnet-5-5',
        }),
      },
    );
    alice = t.signIn('alice@apex.test');
    const created = await t
      .http()
      .post('/v2/objectives')
      .set('Authorization', alice.authorization)
      .send({ title: 'Courir un marathon' });
    objectiveId = created.body.id;
  });

  afterEach(() => t.close());

  const waitFor = async (status: 'ready' | 'awaiting-permission') => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await t
        .http()
        .get(`/v2/objectives/${objectiveId}/assistant`)
        .set('Authorization', alice.authorization);
      const current = workflowStateResponseSchema.parse(response.body);
      if (current.status === status) return current;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`statut « ${status} » jamais atteint`);
  };

  const send = (message: string) =>
    t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/messages`)
      .set('Authorization', alice.authorization)
      .send({ message });

  it("ajoute un pas avec l'accord de la personne, puis reprend toute la conversation au message suivant", async () => {
    const createTask = {
      type: 'tool_use' as const,
      id: 'toolu_1',
      name: 'createTask',
      input: { objectiveId, title: 'Courir 5 km', importance: 4, urgency: 2 },
      caller: { type: 'direct' as const },
    };
    claude.replies.push(
      { id: 'msg_1', stop_reason: 'tool_use', content: [createTask] },
      text('msg_2', "C'est ajouté."),
      text('msg_3', 'Cours deux fois cette semaine.'),
    );

    await send('Ajoute un pas');
    const waiting = await waitFor('awaiting-permission');
    expect(waiting.pendingToolCall).toMatchObject({ id: 'toolu_1', name: 'createTask' });

    await t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', alice.authorization)
      .send({ granted: true, toolCallId: 'toolu_1' });
    await expect(waitFor('ready')).resolves.toMatchObject({
      lastRegisteredMessage: { sender: 'AI', content: "C'est ajouté." },
    });
    const [task] = [...t.objectives.db.tasks.values()];
    expect(task).toMatchObject({ title: 'Courir 5 km', objectiveId });

    // Les instructions d'Akari et ses outils partent à chaque appel, schémas JSON compris.
    expect(claude.requests[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: expect.stringContaining('Akari'),
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: 'createTask',
          input_schema: expect.objectContaining({
            type: 'object',
            required: expect.arrayContaining(['title']),
          }),
        }),
      ]),
    });
    expect(claude.requests[1].messages.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: JSON.stringify({
            success: true,
            id: task.id,
            title: 'Courir 5 km',
            importance: 4,
            urgency: 2,
          }),
        },
      ],
    });

    await send('Et ensuite ?');
    await expect(waitFor('ready')).resolves.toMatchObject({
      lastRegisteredMessage: { content: 'Cours deux fois cette semaine.' },
    });
    expect(claude.requests[2].messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(claude.requests[2].messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Et ensuite ?' }],
    });
  });
});
