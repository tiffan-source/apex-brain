import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { AIProviderError } from '@org/ai';
import { GeminiInteractiveAIProvider } from './gemini';
import { createGeminiInteractionsClient } from './gemini-interactions.client';

type ReceivedRequest = {
  method?: string;
  url?: string;
  apiKey?: string | string[];
  authorization?: string;
  body: unknown;
};

type PreparedReply = { status: number; contentType?: string; body: string };

/**
 * Le vrai SDK `@google/genai` et le vrai adaptateur, face à un faux serveur Gemini : ce qui part
 * sur le réseau (adresse, en-tête de la clé, corps) et la lecture de vraies réponses HTTP,
 * succès comme refus. Seule la réponse est simulée.
 */
describe('Client Gemini (SDK réel, serveur simulé)', () => {
  let server: Server;
  let provider: GeminiInteractiveAIProvider;
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
          apiKey: request.headers['x-goog-api-key'],
          authorization: request.headers.authorization,
          body: raw ? JSON.parse(raw) : undefined,
        });
        response.writeHead(reply.status, {
          'content-type': reply.contentType ?? 'application/json; charset=UTF-8',
        });
        response.end(reply.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const { port } = server.address() as AddressInfo;
    provider = new GeminiInteractiveAIProvider(
      createGeminiInteractionsClient('cle-de-test', { baseUrl: `http://127.0.0.1:${port}` }),
      { model: 'gemini-3.8-flash' },
    );
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    received.length = 0;
  });

  it('envoie la clé dans x-goog-api-key, seule, et lit la réponse texte', async () => {
    reply = {
      status: 200,
      body: JSON.stringify({
        id: 'i-1',
        status: 'completed',
        steps: [
          { type: 'user_input', content: [{ type: 'text', text: 'Salut' }] },
          { type: 'model_output', content: [{ type: 'text', text: 'Bonjour.' }] },
        ],
      }),
    };

    await expect(
      provider.generateMessage({ prompt: 'Salut', systemInstruction: 'Tu es Akari.' }),
    ).resolves.toEqual({ type: 'message', interactionId: 'i-1', content: 'Bonjour.' });

    expect(received).toEqual([
      {
        method: 'POST',
        url: '/v1beta/interactions',
        apiKey: 'cle-de-test',
        authorization: undefined,
        body: { model: 'gemini-3.8-flash', input: 'Salut', system_instruction: 'Tu es Akari.' },
      },
    ]);
  });

  it("rend les appels d'outils d'une vraie réponse", async () => {
    reply = {
      status: 200,
      body: JSON.stringify({
        id: 'i-2',
        status: 'requires_action',
        steps: [
          { type: 'thought' },
          { type: 'function_call', id: 'call-1', name: 'getObjectiveTree', arguments: { id: 'o1' } },
        ],
      }),
    };

    await expect(provider.generateMessage({ prompt: 'Regarde' })).resolves.toEqual({
      type: 'tool-call',
      interactionId: 'i-2',
      toolCall: [{ id: 'call-1', name: 'getObjectiveTree', arguments: { id: 'o1' } }],
    });
  });

  it('explique un refus de la clé, même sans corps de réponse (401)', async () => {
    reply = { status: 401, body: '' };

    const failure = await provider.generateMessage({ prompt: 'Salut' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure).toMatchObject({ code: 'AI_PROVIDER_FAILURE', metadata: { status: 401 } });
    expect((failure as AIProviderError).message).toBe(
      'Gemini interaction failed (HTTP 401): empty response body' +
        ' — Gemini rejected the API key (missing, invalid or expired): check GEMINI_API_KEY',
    );
  });

  it("reprend le message d'erreur de l'API Interactions", async () => {
    reply = {
      status: 401,
      body: JSON.stringify({ error: { code: 'authentication', message: 'API key not valid.' } }),
    };

    await expect(provider.generateMessage({ prompt: 'Salut' })).rejects.toMatchObject({
      message: expect.stringContaining('(HTTP 401, authentication): API key not valid.'),
      metadata: { status: 401, providerCode: 'authentication' },
    });
  });

  it("cite une page d'erreur HTML au lieu de la réponse JSON attendue", async () => {
    reply = {
      status: 404,
      contentType: 'text/html; charset=UTF-8',
      body: '<!DOCTYPE html><title>404</title>',
    };

    await expect(provider.generateMessage({ prompt: 'Salut' })).rejects.toMatchObject({
      message: 'Gemini interaction failed (HTTP 404): response body: <!DOCTYPE html><title>404</title>',
      metadata: { status: 404 },
    });
  });
});
