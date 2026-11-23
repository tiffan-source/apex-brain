/** À qui un événement peut être montré : `public`, au client de la personne ; `internal`, au serveur seul. */
export type BusAudience = 'public' | 'internal';

/**
 * Un événement du bus : un fait, dans son enveloppe. Rien que des données JSON, pour qu'un bus en
 * mémoire et un bus distant livrent la même chose.
 */
export type BusEvent<TPayload = Record<string, unknown>> = {
  /** Unique : un abonné peut s'en servir pour ne pas traiter deux fois le même événement. */
  id: string;
  /** `<source>.<fait>` : `ai-assistant.turn.succeeded`. Un fait, jamais un état de machine. */
  type: string;
  /** Qui l'a publié : le nom du workflow. */
  source: string;
  /** Ce dont il parle : l'instance du workflow (l'objectif, pour l'assistant). */
  key: string;
  /** La personne à qui l'instance appartient : un flux client ne transmet que ses événements. */
  ownerId: string;
  audience: BusAudience;
  /** Quand le fait a eu lieu (ISO 8601). */
  occurredAt: string;
  payload: TPayload;
};

/**
 * Relire un événement transporté en JSON par un bus distant ; `undefined` si ce n'en est pas un (un
 * message étranger sur le canal, une version incompatible).
 */
export function parseBusEvent(text: string): BusEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const texts = ['id', 'type', 'source', 'key', 'ownerId', 'occurredAt'];

  if (!texts.every((field) => typeof candidate[field] === 'string')) return undefined;
  if (candidate['audience'] !== 'public' && candidate['audience'] !== 'internal') return undefined;
  const payload = candidate['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;

  return candidate as BusEvent;
}
