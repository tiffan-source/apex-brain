import { AIProviderError } from '@org/ai';
import { GeminiInteractiveAIProvider } from './gemini';
import {
  GeminiCreateInteractionParams,
  GeminiInteraction,
  GeminiInteractionsClient,
} from './gemini-interactions.client';

class FakeInteractionsClient implements GeminiInteractionsClient {
  readonly requests: GeminiCreateInteractionParams[] = [];
  constructor(private readonly respond: () => Promise<GeminiInteraction>) {}

  create(params: GeminiCreateInteractionParams): Promise<GeminiInteraction> {
    this.requests.push(params);
    return this.respond();
  }
}

const tool = { name: 'getObjectiveTree', description: "Lire l'arbre", parameters: { type: 'object' } };

describe('GeminiInteractiveAIProvider', () => {
  it('envoie le message avec le modèle, les instructions, les outils et l’interaction précédente', async () => {
    const client = new FakeInteractionsClient(async () => ({
      id: 'i-2',
      status: 'completed',
      output_text: 'Bonjour.',
    }));
    const provider = new GeminiInteractiveAIProvider(client, { model: 'gemini-3.8-flash' });

    const response = await provider.generateMessage({
      prompt: 'Salut',
      previousInteractionId: 'i-1',
      systemInstruction: 'Tu es Akari.',
      tools: [tool],
    });

    expect(response).toEqual({ type: 'message', interactionId: 'i-2', content: 'Bonjour.' });
    expect(client.requests).toEqual([
      {
        model: 'gemini-3.8-flash',
        input: 'Salut',
        previous_interaction_id: 'i-1',
        system_instruction: 'Tu es Akari.',
        tools: [
          {
            type: 'function',
            name: 'getObjectiveTree',
            description: "Lire l'arbre",
            parameters: { type: 'object' },
          },
        ],
      },
    ]);
  });

  it('rend les appels de fonction demandés par le modèle', async () => {
    const client = new FakeInteractionsClient(async () => ({
      id: 'i-3',
      status: 'requires_action',
      steps: [
        { type: 'thought' },
        { type: 'function_call', id: 'call-1', name: 'getObjectiveTree', arguments: { id: 'o1' } },
      ],
    }));
    const provider = new GeminiInteractiveAIProvider(client, { model: 'gemini-3.8-flash' });

    await expect(provider.generateMessage({ prompt: 'Regarde' })).resolves.toEqual({
      type: 'tool-call',
      interactionId: 'i-3',
      toolCall: [{ id: 'call-1', name: 'getObjectiveTree', arguments: { id: 'o1' } }],
    });
  });

  it('renvoie les résultats des outils avec les outils et les instructions', async () => {
    const client = new FakeInteractionsClient(async () => ({ id: 'i-4', output_text: 'Vu.' }));
    const provider = new GeminiInteractiveAIProvider(client, { model: 'gemini-3.8-flash' });

    await provider.sendToolCallResult(
      'i-3',
      [{ id: 'call-1', functionName: 'getObjectiveTree', result: { id: 'o1' } }],
      { systemInstruction: 'Tu es Akari.', tools: [tool] },
    );

    expect(client.requests[0]).toEqual({
      model: 'gemini-3.8-flash',
      previous_interaction_id: 'i-3',
      system_instruction: 'Tu es Akari.',
      tools: [expect.objectContaining({ name: 'getObjectiveTree' })],
      input: [
        {
          type: 'function_result',
          name: 'getObjectiveTree',
          call_id: 'call-1',
          result: [{ type: 'text', text: '{"id":"o1"}' }],
        },
      ],
    });
  });

  it('traduit une panne du SDK et une interaction échouée en AIProviderError', async () => {
    const failing = new GeminiInteractiveAIProvider(
      new FakeInteractionsClient(async () => {
        throw Object.assign(new Error('Resource exhausted'), { status: 429 });
      }),
      { model: 'gemini-3.8-flash' },
    );
    const failed = new GeminiInteractiveAIProvider(
      new FakeInteractionsClient(async () => ({ id: 'i-5', status: 'failed' })),
      { model: 'gemini-3.8-flash' },
    );

    await expect(failing.generateMessage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_FAILURE',
      metadata: { status: 429 },
    });
    await expect(failed.generateMessage({ prompt: 'x' })).rejects.toBeInstanceOf(AIProviderError);
  });

  it('nomme les pannes que Gemini a notées sur une interaction échouée', async () => {
    const failed = new GeminiInteractiveAIProvider(
      new FakeInteractionsClient(async () => ({
        id: 'i-6',
        status: 'failed',
        errors: [{ code: 'api_error', message: 'Internal error encountered.' }],
      })),
      { model: 'gemini-3.8-flash' },
    );

    await expect(failed.generateMessage({ prompt: 'x' })).rejects.toMatchObject({
      code: 'AI_PROVIDER_FAILURE',
      message: 'Gemini interaction i-6 ended with status failed: api_error: Internal error encountered.',
      metadata: { status: 'failed' },
    });
  });
});
