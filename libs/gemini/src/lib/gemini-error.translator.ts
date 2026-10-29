import { AIProviderError } from '@org/ai';

/**
 * Ce que les erreurs HTTP du SDK `@google/genai` (`APIError` et ses sous-classes) exposent et qui
 * nous sert. Les en-têtes sont ceux de la réponse : ceux de la requête, qui portent la clé, ne sont
 * jamais lus.
 */
export type GeminiSdkErrorLike = {
  message?: string;
  status?: number;
  /** Le corps brut de la réponse ; chaîne vide quand Gemini n'en envoie pas. */
  body?: string;
  /** Le corps déjà décodé par le SDK (`{ error: { code, message } }` s'il a la forme attendue). */
  error?: unknown;
  headers?: { get?: (name: string) => string | null };
};

/** La panne telle que Gemini la décrit dans le corps de sa réponse. */
type ProviderFailure = { code?: string; message?: string; reason?: string };

const MAX_DETAIL_LENGTH = 300;

/** Ce qu'un refus veut dire, pour qui lit les logs (codes de l'API Interactions). */
const HINTS: Record<number, string> = {
  401: 'Gemini rejected the API key (missing, invalid or expired): check GEMINI_API_KEY',
  403: 'the API key is not allowed to use this resource (key restrictions, project access): check GEMINI_API_KEY',
};

/**
 * Traduire une panne du SDK Gemini en `AIProviderError` lisible : statut HTTP, code et message de
 * Gemini (ou son corps brut, tronqué, s'il n'a pas la forme attendue), et la piste à suivre quand
 * la clé est refusée.
 *
 * Le message du SDK ne suffit pas : quand le corps de la réponse est vide ou inattendu, il ne dit
 * que « 401 API error occurred » suivi d'un objet vide, sans rien sur la cause.
 */
export function translateGeminiError(error: unknown): AIProviderError {
  const failure = (typeof error === 'object' && error !== null ? error : {}) as GeminiSdkErrorLike;
  const status = typeof failure.status === 'number' ? failure.status : undefined;

  if (status === undefined) {
    // Pas de réponse HTTP (réseau, délai dépassé…) : le message du SDK dit déjà tout.
    return new AIProviderError(`Gemini interaction failed: ${messageOf(error)}`);
  }

  const provider = readProviderFailure(failure);
  const qualifiers = [String(status), provider?.code, provider?.reason].filter(Boolean);
  const detail = provider?.message ? truncate(provider.message) : describeBody(failure, status);
  const challenge = status === 401 ? readHeader(failure, 'www-authenticate') : null;
  const hint = HINTS[status];

  return new AIProviderError(
    `Gemini interaction failed (HTTP ${qualifiers.join(', ')}): ${detail}` +
      (challenge ? ` [WWW-Authenticate: ${truncate(challenge)}]` : '') +
      (hint ? ` — ${hint}` : ''),
    { status, ...(provider?.code ? { providerCode: provider.code } : {}) },
  );
}

function readProviderFailure(failure: GeminiSdkErrorLike): ProviderFailure | undefined {
  return fromPayload(failure.error) ?? fromPayload(parseJson(failure.body));
}

/**
 * `{ error: { … } }`, éventuellement dans un tableau. Deux formes : celle de l'API Interactions
 * (`code` est un identifiant, `authentication`) et celle des API Google (`code` est le statut
 * HTTP, `status` l'identifiant, `UNAUTHENTICATED`, et la raison est dans `details`).
 */
function fromPayload(payload: unknown): ProviderFailure | undefined {
  const root = Array.isArray(payload) ? payload[0] : payload;
  const error = isRecord(root) ? root['error'] : undefined;
  if (!isRecord(error)) return undefined;

  const message = nonEmptyString(error['message']);
  const code = nonEmptyString(error['code']) ?? nonEmptyString(error['status']);
  const reason = Array.isArray(error['details'])
    ? error['details']
        .map((detail) => (isRecord(detail) ? nonEmptyString(detail['reason']) : undefined))
        .find(Boolean)
    : undefined;

  return message || code || reason ? { code, message, reason } : undefined;
}

function describeBody(failure: GeminiSdkErrorLike, status: number): string {
  if (typeof failure.body !== 'string') {
    // Erreur sans corps connu : son message, sans le statut que le SDK met en tête.
    return truncate(messageOf(failure).replace(new RegExp(`^${status}\\s+`), ''));
  }

  const body = failure.body.replace(/\s+/g, ' ').trim();
  return body === '' || body === '{}' ? 'empty response body' : `response body: ${truncate(body)}`;
}

function readHeader(failure: GeminiSdkErrorLike, name: string): string | null {
  return typeof failure.headers?.get === 'function' ? failure.headers.get(name) : null;
}

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error['message'] === 'string') return error['message'];
  return String(error);
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
