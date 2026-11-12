import { AIProviderError } from '@org/ai';
import { translateClaudeError } from './claude-error.translator';

/** Une erreur HTTP comme le SDK `@anthropic-ai/sdk` les lève (`APIError`), sur une réponse donnée. */
function sdkError(
  status: number,
  body: { type?: string; message?: string; error_code?: string } | string | null,
  requestID: string | null = 'req_123',
) {
  const error =
    body && typeof body === 'object'
      ? {
          type: 'error',
          error: { ...body, ...(body.error_code ? { details: { error_code: body.error_code } } : {}) },
        }
      : undefined;
  const message = error
    ? `${status} ${JSON.stringify(error)}`
    : typeof body === 'string'
      ? `${status} ${body}`
      : `${status} status code (no body)`;

  return Object.assign(new Error(message), {
    status,
    error,
    requestID,
    type: error?.error.type ?? null,
    apiMessage: error?.error.message ?? null,
    errorCode: error?.error.error_code ?? null,
  });
}

describe('translateClaudeError', () => {
  it("nomme la clé refusée, avec le message d'Anthropic et l'id de la requête (401)", () => {
    const translated = translateClaudeError(
      sdkError(401, { type: 'authentication_error', message: 'invalid x-api-key' }),
    );

    expect(translated).toBeInstanceOf(AIProviderError);
    expect(translated).toMatchObject({
      code: 'AI_PROVIDER_FAILURE',
      metadata: { status: 401, providerCode: 'authentication_error', requestId: 'req_123' },
    });
    expect(translated.message).toBe(
      'Claude request failed (HTTP 401, authentication_error): invalid x-api-key [request-id: req_123]' +
        ' — Anthropic rejected the API key (missing, invalid or disabled): check ANTHROPIC_API_KEY',
    );
  });

  it('explique un refus sans corps de réponse', () => {
    const translated = translateClaudeError(sdkError(401, null, null));

    expect(translated.message).toBe(
      'Claude request failed (HTTP 401): empty response body' +
        ' — Anthropic rejected the API key (missing, invalid or disabled): check ANTHROPIC_API_KEY',
    );
    expect(translated.metadata).toEqual({ status: 401 });
  });

  it('désigne le modèle quand la ressource est inconnue (404)', () => {
    const translated = translateClaudeError(
      sdkError(404, { type: 'not_found_error', message: 'model: claude-inconnu' }),
    );

    expect(translated.message).toContain('(HTTP 404, not_found_error): model: claude-inconnu');
    expect(translated.message).toContain('check CLAUDE_MODEL');
  });

  it('désigne la facturation quand Anthropic ne peut pas facturer', () => {
    const translated = translateClaudeError(
      sdkError(400, { type: 'billing_error', message: 'Your credit balance is too low.' }),
    );

    expect(translated.message).toContain('(HTTP 400, billing_error): Your credit balance is too low.');
    expect(translated.message).toContain('check its billing in the Claude Console');
  });

  it('reprend la cause précise donnée par Anthropic, sans piste pour une panne passagère', () => {
    const overloaded = translateClaudeError(
      sdkError(529, { type: 'overloaded_error', message: 'Overloaded' }),
    );
    const invalid = translateClaudeError(
      sdkError(400, {
        type: 'invalid_request_error',
        message: 'tool_use ids were found without tool_result blocks',
        error_code: 'tool_result_missing',
      }),
    );

    expect(overloaded.message).toBe(
      'Claude request failed (HTTP 529, overloaded_error): Overloaded [request-id: req_123]',
    );
    expect(overloaded.metadata).toEqual({
      status: 529,
      providerCode: 'overloaded_error',
      requestId: 'req_123',
    });
    expect(invalid.message).toContain('(HTTP 400, invalid_request_error, tool_result_missing)');
    expect(invalid.metadata).toMatchObject({ errorCode: 'tool_result_missing' });
  });

  it('cite, tronqué, un corps inattendu', () => {
    const translated = translateClaudeError(sdkError(502, `<html>${'x'.repeat(1000)}</html>`, null));

    expect(translated.message).toMatch(/^Claude request failed \(HTTP 502\): response body: <html>x+…$/);
    expect(translated.message.length).toBeLessThan(400);
  });

  it('garde le message du SDK quand aucune réponse HTTP n’est arrivée', () => {
    const translated = translateClaudeError(new Error('Connection error.'));

    expect(translated.message).toBe('Claude request failed: Connection error.');
    expect(translated.metadata).toBeUndefined();
  });
});
