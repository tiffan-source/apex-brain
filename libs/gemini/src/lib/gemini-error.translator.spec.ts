import { AIProviderError } from '@org/ai';
import { translateGeminiError } from './gemini-error.translator';

/** Une erreur HTTP comme le SDK `@google/genai` les lève (`APIError`), sur une réponse donnée. */
function sdkError(status: number, body: string, headers: Record<string, string> = {}) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    decoded = undefined;
  }
  const error = (decoded as { error?: { message?: string } } | undefined)?.error;
  const httpMeta = { response: {}, request: {} };

  return Object.assign(
    new Error(`${status} ${error?.message ?? `API error occurred: ${JSON.stringify({ httpMeta })}`}`),
    {
      status,
      body,
      error: {
        httpMeta,
        ...(decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {}),
      },
      headers: new Headers({ 'content-type': 'application/json; charset=UTF-8', ...headers }),
    },
  );
}

describe('translateGeminiError', () => {
  it('nomme la clé refusée quand Gemini répond 401 sans corps (panne du 29 octobre 2026)', () => {
    const translated = translateGeminiError(sdkError(401, ''));

    expect(translated).toBeInstanceOf(AIProviderError);
    expect(translated).toMatchObject({ code: 'AI_PROVIDER_FAILURE', metadata: { status: 401 } });
    expect(translated.message).toBe(
      'Gemini interaction failed (HTTP 401): empty response body' +
        ' — Gemini rejected the API key (missing, invalid or expired): check GEMINI_API_KEY',
    );
  });

  it("reprend le code et le message de l'API Interactions", () => {
    const translated = translateGeminiError(
      sdkError(
        401,
        '{"error":{"code":"authentication","message":"API key expired. Please renew the API key."}}',
      ),
    );

    expect(translated).toMatchObject({ metadata: { status: 401, providerCode: 'authentication' } });
    expect(translated.message).toContain(
      '(HTTP 401, authentication): API key expired. Please renew the API key.',
    );
    expect(translated.message).toContain('check GEMINI_API_KEY');
  });

  it('lit le format des API Google : statut et raison du refus', () => {
    const translated = translateGeminiError(
      sdkError(
        401,
        JSON.stringify({
          error: {
            code: 401,
            message: 'Request had invalid authentication credentials.',
            status: 'UNAUTHENTICATED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED',
              },
            ],
          },
        }),
      ),
    );

    expect(translated.message).toContain(
      '(HTTP 401, UNAUTHENTICATED, ACCESS_TOKEN_TYPE_UNSUPPORTED): Request had invalid authentication credentials.',
    );
    expect(translated.metadata).toEqual({ status: 401, providerCode: 'UNAUTHENTICATED' });
  });

  it('lit une erreur rendue dans un tableau', () => {
    const translated = translateGeminiError(
      sdkError(403, '[{"error":{"code":403,"message":"Permission denied.","status":"PERMISSION_DENIED"}}]'),
    );

    expect(translated.message).toContain('(HTTP 403, PERMISSION_DENIED): Permission denied.');
    expect(translated.message).toContain('check GEMINI_API_KEY');
  });

  it("joint l'en-tête WWW-Authenticate d'un 401", () => {
    const translated = translateGeminiError(
      sdkError(401, '', {
        'www-authenticate': 'Bearer realm="https://accounts.google.com/", error="invalid_token"',
      }),
    );

    expect(translated.message).toContain(
      '[WWW-Authenticate: Bearer realm="https://accounts.google.com/", error="invalid_token"]',
    );
  });

  it('cite, tronqué, un corps inattendu, sans piste sur la clé hors 401 et 403', () => {
    const translated = translateGeminiError(sdkError(502, `<html>${'x'.repeat(1000)}</html>`));

    expect(translated.message).toMatch(/^Gemini interaction failed \(HTTP 502\): response body: <html>x+…$/);
    expect(translated.message.length).toBeLessThan(400);
    expect(translated.message).not.toContain('GEMINI_API_KEY');
  });

  it('garde le message du SDK quand il ne connaît pas le corps', () => {
    const translated = translateGeminiError(Object.assign(new Error('Resource exhausted'), { status: 429 }));

    expect(translated.message).toBe('Gemini interaction failed (HTTP 429): Resource exhausted');
    expect(translated.metadata).toEqual({ status: 429 });
  });

  it('garde le message du SDK quand aucune réponse HTTP n’est arrivée', () => {
    const translated = translateGeminiError(new Error('Connection error.'));

    expect(translated.message).toBe('Gemini interaction failed: Connection error.');
    expect(translated.metadata).toBeUndefined();
  });
});
