import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { AIProviderError, InMemoryInteractionHistoryRepository } from '@org/ai';
import { ClaudeInteractiveAIProvider } from './claude';
import { createClaudeMessagesClient } from './claude-messages.client';

type ReceivedRequest = {
  method?: string;
  url?: string;
  apiKey?: string | string[];
  authorization?: string;
  version?: string | string[];
  body: unknown;
};

type PreparedReply = { status: number; headers?: Record<string, string>; body: string };

const message = (body: Record<string, unknown>) =>
  JSON.stringify({
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...body,
  });

/**
 * Le vrai SDK `@anthropic-ai/sdk` et le vrai adaptateur, face à un faux serveur Anthropic : ce qui
 * part sur le réseau (adresse, en-têtes, corps) et la lecture de vraies réponses HTTP, succès comme
 * refus. Seule la réponse est simulée.
 */
describe('Client Claude (SDK réel, serveur simulé)', () => {
  let server: Server;
  let provider: ClaudeInteractiveAIProvider;
  const received: ReceivedRequest[] = [];
  let reply: PreparedReply = { status: 200, body: '{}' };

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => {
        received.push({
          method: request.method,
          url: request.url,
          apiKey: request.headers['x-api-key'],
          authorization: request.headers.authorization,
          version: request.headers['anthropic-version'],
          body: raw ? JSON.parse(raw) : undefined,
        });
        response.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
        response.end(reply.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const { port } = server.address() as AddressInfo;
    provider = new ClaudeInteractiveAIProvider(
      createClaudeMessagesClient('cle-de-test', { baseUrl: `http://127.0.0.1:${port}` }),
      new InMemoryInteractionHistoryRepository(),
      { model: 'claude-sonnet-5-5' },
    );
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    received.length = 0;
  });

  it("envoie la clé dans l'en-tête Authorization, avec la version de l'API, et lit la réponse texte", async () => {
    reply = {
      status: 200,
      body: message({
        id: 'msg_1',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Bonjour.', citations: null }],
      }),
    };

    await expect(
      provider.generateMessage({ prompt: 'Salut', systemInstruction: 'Tu es Akari.' }),
    ).resolves.toEqual({ type: 'message', interactionId: 'msg_1', content: 'Bonjour.' });

    expect(received).toEqual([
      {
        method: 'POST',
        url: '/v1/messages',
        apiKey: undefined,
        authorization: 'Bearer cle-de-test',
        version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        body: {
          model: 'claude-sonnet-5-5',
          max_tokens: 8192,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Salut' }] }],
          system: 'Tu es Akari.',
          cache_control: { type: 'ephemeral' },
        },
      },
    ]);
  });

  it("rend les appels d'outils d'une vraie réponse", async () => {
    reply = {
      status: 200,
      body: message({
        id: 'msg_2',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'getObjectiveTree',
            input: { id: 'o1' },
            caller: { type: 'direct' },
          },
        ],
      }),
    };

    await expect(provider.generateMessage({ prompt: 'Regarde' })).resolves.toEqual({
      type: 'tool-call',
      interactionId: 'msg_2',
      toolCall: [{ id: 'toolu_1', name: 'getObjectiveTree', arguments: { id: 'o1' } }],
    });
  });

  it("explique un refus de la clé avec le message d'Anthropic et l'id de la requête (401)", async () => {
    reply = {
      status: 401,
      headers: { 'request-id': 'req_401' },
      body: JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
        request_id: 'req_401',
      }),
    };

    const failure = await provider.generateMessage({ prompt: 'Salut' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure).toMatchObject({
      code: 'AI_PROVIDER_FAILURE',
      metadata: { status: 401, providerCode: 'authentication_error', requestId: 'req_401' },
    });
    expect((failure as AIProviderError).message).toBe(
      'Claude request failed (HTTP 401, authentication_error): invalid x-api-key [request-id: req_401]' +
        ' — Anthropic rejected the API key (missing, invalid or disabled): check ANTHROPIC_API_KEY',
    );
  });

  it('explique un refus sans corps de réponse', async () => {
    reply = { status: 403, body: '' };

    await expect(provider.generateMessage({ prompt: 'Salut' })).rejects.toMatchObject({
      message: expect.stringContaining('(HTTP 403): empty response body'),
      metadata: { status: 403 },
    });
  });

  it('rend la surcharge de Claude quand Anthropic dit de ne pas réessayer', async () => {
    reply = {
      status: 529,
      headers: { 'x-should-retry': 'false' },
      body: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    };

    await expect(provider.generateMessage({ prompt: 'Salut' })).rejects.toMatchObject({
      message: 'Claude request failed (HTTP 529, overloaded_error): Overloaded',
      metadata: { status: 529, providerCode: 'overloaded_error' },
    });
    expect(received).toHaveLength(1);
  });
});
