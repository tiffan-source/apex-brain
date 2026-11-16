import { AIProviderError } from '@org/ai';

/**
 * Ce que les erreurs HTTP du SDK `@anthropic-ai/sdk` (`APIError` et ses sous-classes) exposent et qui
 * nous sert. Les en-têtes sont ceux de la réponse : ceux de la requête, qui portent la clé, ne sont
 * jamais lus.
 */
export type ClaudeSdkErrorLike = {
  /** Le message du SDK : le statut suivi du corps de la réponse, quand il n'en a rien tiré. */
  message?: string;
  status?: number;
  /** `error.type` du corps de la réponse : `authentication_error`, `overloaded_error`… */
  type?: string | null;
  /** `error.message` du corps de la réponse. */
  apiMessage?: string | null;
  /** `error.details.error_code` : la cause précise, quand Anthropic la donne. */
  errorCode?: string | null;
  /** L'en-tête `request-id` de la réponse, à donner au support d'Anthropic. */
  requestID?: string | null;
};

const MAX_DETAIL_LENGTH = 300;

/** Ce qu'un refus veut dire, pour qui lit les logs. */
const HINTS_BY_STATUS: Record<number, string> = {
  401: 'Anthropic rejected the API key (missing, invalid or disabled): check ANTHROPIC_API_KEY',
  403: 'the API key is not allowed to use this resource (workspace, organization): check ANTHROPIC_API_KEY',
  404: 'unknown resource, usually the model name: check CLAUDE_MODEL',
};

const BILLING_HINT =
  'the Anthropic organization cannot be billed (credit balance, payment method): check its billing in the Claude Console';

/**
 * Traduire une panne du SDK Claude en `AIProviderError` lisible : statut HTTP, type et cause donnés
 * par Anthropic, son message (ou le corps brut, tronqué), l'id de la requête et, quand c'est la
 * configuration qui pèche, la variable à vérifier.
 */
export function translateClaudeError(error: unknown): AIProviderError {
  const failure = (typeof error === 'object' && error !== null ? error : {}) as ClaudeSdkErrorLike;
  const status = typeof failure.status === 'number' ? failure.status : undefined;

  if (status === undefined) {
    // Pas de réponse HTTP (réseau, délai dépassé…) : le message du SDK dit déjà tout.
    return new AIProviderError(`Claude request failed: ${messageOf(error) || 'unknown error'}`);
  }

  const type = nonEmptyString(failure.type);
  const errorCode = nonEmptyString(failure.errorCode);
  const requestId = nonEmptyString(failure.requestID);
  const apiMessage = nonEmptyString(failure.apiMessage);
  const qualifiers = [String(status), type, errorCode].filter(Boolean);
  const detail = apiMessage ? truncate(apiMessage) : describeBody(failure, status);
  const hint = type === 'billing_error' ? BILLING_HINT : HINTS_BY_STATUS[status];

  return new AIProviderError(
    `Claude request failed (HTTP ${qualifiers.join(', ')}): ${detail}` +
      (requestId ? ` [request-id: ${requestId}]` : '') +
      (hint ? ` — ${hint}` : ''),
    {
      status,
      ...(type ? { providerCode: type } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(requestId ? { requestId } : {}),
    },
  );
}

/** Sans message d'Anthropic, le SDK met le corps brut après le statut (ou « status code (no body) »). */
function describeBody(failure: ClaudeSdkErrorLike, status: number): string {
  const body = messageOf(failure)
    .replace(new RegExp(`^${status}\\s*`), '')
    .replace(/\s+/g, ' ')
    .trim();
  return body === '' || body === 'status code (no body)' || body === '{}'
    ? 'empty response body'
    : `response body: ${truncate(body)}`;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) return typeof error['message'] === 'string' ? error['message'] : '';
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
