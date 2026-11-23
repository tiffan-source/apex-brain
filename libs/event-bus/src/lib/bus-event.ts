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
