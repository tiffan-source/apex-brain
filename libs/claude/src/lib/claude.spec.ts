import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { AIProviderError, InMemoryInteractionHistoryRepository, InteractionHistoryRepository } from '@org/ai';
import { ClaudeConfig, ClaudeInteractiveAIProvider } from './claude';
import { INTERRUPTED_TOOL_RESULT } from './claude-history';
import { ClaudeCreateMessageParams, ClaudeMessage, ClaudeMessagesClient } from './claude-messages.client';

class FakeMessagesClient implements ClaudeMessagesClient {
  readonly requests: ClaudeCreateMessageParams[] = [];
  private readonly replies: Array<ClaudeMessage | Error> = [];

  willReply(...replies: Array<ClaudeMessage | Error>): this {
    this.replies.push(...replies);
    return this;
  }

  async create(params: ClaudeCreateMessageParams): Promise<ClaudeMessage> {
    this.requests.push(structuredClone(params));
    const reply = this.replies.shift();
    if (!reply) throw new Error('FakeMessagesClient : plus aucune réponse prévue');
    if (reply instanceof Error) throw reply;
    return reply;
  }
}

const text = (
  id: string,
  content: string,
  stopReason: ClaudeMessage['stop_reason'] = 'end_turn',
): ClaudeMessage => ({
  id,
  stop_reason: stopReason,
  content: [{ type: 'text', text: content, citations: null }],
});

const toolUse = (
  id: string,
  ...calls: Array<{ id: string; name: string; input: unknown }>
): ClaudeMessage => ({
  id,
  stop_reason: 'tool_use',
  content: [
    { type: 'text', text: 'Je regarde.', citations: null },
    ...calls.map((call) => ({ type: 'tool_use' as const, caller: { type: 'direct' as const }, ...call })),
  ],
});

const prompt = (content: string): MessageParam => ({
  role: 'user',
  content: [{ type: 'text', text: content }],
});

const tool = { name: 'getObjectiveTree', description: "Lire l'arbre", parameters: { type: 'object' } };

function setup(
  config: Partial<ClaudeConfig> = {},
  histories: InteractionHistoryRepository = new InMemoryInteractionHistoryRepository(),
) {
  const client = new FakeMessagesClient();
  const warnings: string[] = [];
  const provider = new ClaudeInteractiveAIProvider(client, histories, {
    model: 'claude-sonnet-5-5',
    logger: { warn: (message) => warnings.push(message) },
    ...config,
  });
  return { client, provider, histories, warnings };
}

describe('ClaudeInteractiveAIProvider', () => {
  it('envoie le message avec le modèle, le plafond, les instructions, les outils et le cache', async () => {
    const { client, provider, histories } = setup();
    client.willReply(text('msg_1', 'Bonjour.'));

    const response = await provider.generateMessage({
      prompt: 'Salut',
      systemInstruction: 'Tu es Akari.',
      tools: [tool],
    });

    expect(response).toEqual({ type: 'message', interactionId: 'msg_1', content: 'Bonjour.' });
    expect(client.requests).toEqual([
      {
        model: 'claude-sonnet-5-5',
        max_tokens: 8192,
        messages: [prompt('Salut')],
        system: 'Tu es Akari.',
        tools: [{ name: 'getObjectiveTree', description: "Lire l'arbre", input_schema: { type: 'object' } }],
        cache_control: { type: 'ephemeral' },
      },
    ]);
    await expect(histories.findById('msg_1')).resolves.toMatchObject({
      interactionId: 'msg_1',
      provider: 'claude',
      messages: [
        prompt('Salut'),
        { role: 'assistant', content: [{ type: 'text', text: 'Bonjour.', citations: null }] },
      ],
    });
  });

  it("envoie toute la conversation jusqu'à l'interaction précédente", async () => {
    const { client, provider } = setup();
    client.willReply(text('msg_1', 'Bonjour.'), text('msg_2', 'Avec plaisir.'));

    await provider.generateMessage({ prompt: 'Salut' });
    await expect(
      provider.generateMessage({ prompt: 'Aide-moi', previousInteractionId: 'msg_1' }),
    ).resolves.toEqual({
      type: 'message',
      interactionId: 'msg_2',
      content: 'Avec plaisir.',
    });

    expect(client.requests[1].messages).toEqual([
      prompt('Salut'),
      { role: 'assistant', content: [{ type: 'text', text: 'Bonjour.', citations: null }] },
      prompt('Aide-moi'),
    ]);
  });

  it('rend les outils demandés, puis leur renvoie les résultats avec la conversation, les outils et les instructions', async () => {
    const { client, provider } = setup();
    client.willReply(
      toolUse('msg_1', { id: 'toolu_1', name: 'getObjectiveTree', input: { id: 'o1' } }),
      text('msg_2', 'Ton objectif a deux étapes.'),
    );

    await expect(provider.generateMessage({ prompt: 'Regarde', tools: [tool] })).resolves.toEqual({
      type: 'tool-call',
      interactionId: 'msg_1',
      toolCall: [{ id: 'toolu_1', name: 'getObjectiveTree', arguments: { id: 'o1' } }],
    });

    await expect(
      provider.sendToolCallResult(
        'msg_1',
        [{ id: 'toolu_1', functionName: 'getObjectiveTree', result: { id: 'o1' } }],
        { systemInstruction: 'Tu es Akari.', tools: [tool] },
      ),
    ).resolves.toEqual({ type: 'message', interactionId: 'msg_2', content: 'Ton objectif a deux étapes.' });

    expect(client.requests[1]).toMatchObject({
      system: 'Tu es Akari.',
      tools: [expect.objectContaining({ name: 'getObjectiveTree' })],
      messages: [
        prompt('Regarde'),
        {
          role: 'assistant',
          content: toolUse('msg_1', { id: 'toolu_1', name: 'getObjectiveTree', input: { id: 'o1' } }).content,
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"id":"o1"}' }] },
      ],
    });
  });

  it("clôt les outils d'un tour interrompu avant le message suivant de la personne", async () => {
    const { client, provider } = setup();
    client.willReply(
      toolUse('msg_1', { id: 'toolu_1', name: 'createTask', input: { title: 'Courir' } }),
      text('msg_2', 'Reprenons.'),
    );

    await provider.generateMessage({ prompt: 'Ajoute un pas' });
    // Le tour s'est arrêté pendant l'outil : la personne écrit de nouveau.
    await provider.generateMessage({ prompt: 'Alors ?', previousInteractionId: 'msg_1' });

    expect(client.requests[1].messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: INTERRUPTED_TOOL_RESULT, is_error: true },
        { type: 'text', text: 'Alors ?' },
      ],
    });
  });

  it('repart de zéro, et le signale, quand l’interaction précédente n’a pas d’historique', async () => {
    const histories = new InMemoryInteractionHistoryRepository();
    // Un historique d'un autre fournisseur ne se relit pas non plus.
    await histories.save({ interactionId: 'msg_autre', provider: 'autre', messages: [], createdAt: '' });
    const { client, provider, warnings } = setup({}, histories);
    client.willReply(text('msg_1', 'Bonjour.'), text('msg_2', 'Bonjour.'));

    // Une interaction de Gemini, gardée par un workflow d'avant le changement de fournisseur.
    await provider.generateMessage({ prompt: 'Salut', previousInteractionId: 'v1_interaction-gemini' });
    await provider.generateMessage({ prompt: 'Salut', previousInteractionId: 'msg_autre' });

    expect(client.requests.map((request) => request.messages)).toEqual([
      [prompt('Salut')],
      [prompt('Salut')],
    ]);
    expect(warnings).toEqual([
      'Claude interaction v1_interaction-gemini has no stored history: the conversation starts over',
      'Claude interaction msg_autre has no stored history: the conversation starts over',
    ]);
  });

  it("refuse d'envoyer des résultats d'outils à une interaction sans historique", async () => {
    const { client, provider } = setup();

    await expect(
      provider.sendToolCallResult('v1_interaction-gemini', [
        { id: 'call-1', functionName: 'getObjectiveTree', result: null },
      ]),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_FAILURE',
      message:
        'Claude interaction v1_interaction-gemini has no stored history: the tool results cannot be sent',
    });
    expect(client.requests).toEqual([]);
  });

  it('garde les blocs de réflexion tels quels pour la suite de la conversation', async () => {
    const { client, provider } = setup();
    client.willReply(
      {
        id: 'msg_1',
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig-opaque' },
          { type: 'text', text: 'Bonjour.', citations: null },
        ],
      },
      text('msg_2', 'Oui.'),
    );

    await expect(provider.generateMessage({ prompt: 'Salut' })).resolves.toMatchObject({
      content: 'Bonjour.',
    });
    await provider.generateMessage({ prompt: 'Tu es là ?', previousInteractionId: 'msg_1' });

    expect(client.requests[1].messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig-opaque' },
        { type: 'text', text: 'Bonjour.', citations: null },
      ],
    });
  });

  it("ne garde pas une réponse vide, que l'API refuserait dans la suite de la conversation", async () => {
    const { client, provider } = setup();
    client.willReply({ id: 'msg_1', stop_reason: 'end_turn', content: [] }, text('msg_2', 'Bonjour.'));

    await expect(provider.generateMessage({ prompt: 'Salut' })).resolves.toEqual({
      type: 'message',
      interactionId: 'msg_1',
      content: '',
    });
    await provider.generateMessage({ prompt: 'Tu es là ?', previousInteractionId: 'msg_1' });

    expect(client.requests[1].messages).toEqual([prompt('Salut'), prompt('Tu es là ?')]);
  });

  it("n'envoie que les tours les plus récents au-delà de la taille maximale de l'historique", async () => {
    const { client, provider } = setup({ maxHistoryBytes: 1 });
    client.willReply(text('msg_1', 'Bonjour.'), text('msg_2', 'Avec plaisir.'));

    await provider.generateMessage({ prompt: 'Salut' });
    await provider.generateMessage({ prompt: 'Aide-moi', previousInteractionId: 'msg_1' });

    expect(client.requests[1].messages).toEqual([prompt('Aide-moi')]);
  });

  it('rend le texte d’une réponse tronquée par max_tokens', async () => {
    const { client, provider } = setup({ maxTokens: 100 });
    client.willReply(text('msg_1', 'Une réponse coup', 'max_tokens'));

    await expect(provider.generateMessage({ prompt: 'Raconte' })).resolves.toEqual({
      type: 'message',
      interactionId: 'msg_1',
      content: 'Une réponse coup',
    });
    expect(client.requests[0].max_tokens).toBe(100);
  });

  it("lève une AIProviderError pour une réponse inexploitable, sans l'enregistrer", async () => {
    const { client, provider, histories } = setup();
    client.willReply(
      { id: 'msg_1', stop_reason: 'refusal', content: [] },
      { id: 'msg_2', stop_reason: 'model_context_window_exceeded', content: [] },
      {
        id: 'msg_3',
        stop_reason: 'max_tokens',
        content: [{ type: 'thinking', thinking: '', signature: 's' }],
      },
    );

    await expect(provider.generateMessage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_FAILURE',
      message: 'Claude message msg_1 ended with stop_reason refusal: Claude declined to answer',
      metadata: { stopReason: 'refusal' },
    });
    await expect(provider.generateMessage({ prompt: 'x' })).rejects.toThrow(/context window/);
    await expect(provider.generateMessage({ prompt: 'x' })).rejects.toThrow(/max_tokens before any text/);
    expect((histories as InMemoryInteractionHistoryRepository).size).toBe(0);
  });

  it('traduit une panne du SDK en AIProviderError', async () => {
    const { client, provider } = setup();
    client.willReply(
      Object.assign(new Error('529 Overloaded'), {
        status: 529,
        type: 'overloaded_error',
        apiMessage: 'Overloaded',
      }),
    );

    await expect(provider.generateMessage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_FAILURE',
      metadata: { status: 529, providerCode: 'overloaded_error' },
    });
  });

  it("lève une AIProviderError quand l'historique ne peut pas être enregistré", async () => {
    const failing = new (class extends InMemoryInteractionHistoryRepository {
      override async save(): Promise<void> {
        throw new Error('Firestore indisponible');
      }
    })();
    const { client, provider } = setup({}, failing);
    client.willReply(text('msg_1', 'Bonjour.'));

    const failure = await provider.generateMessage({ prompt: 'Salut' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AIProviderError);
    expect((failure as AIProviderError).message).toBe(
      'Claude interaction msg_1: the history could not be saved: Firestore indisponible',
    );
  });
});
