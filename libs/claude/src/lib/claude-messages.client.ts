import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';

/** Les paramètres d'un appel à l'API Messages, tels que le SDK les attend. */
export type ClaudeCreateMessageParams = MessageCreateParamsNonStreaming;

/** Ce que l'adaptateur lit d'un message rendu par Claude. */
export type ClaudeMessage = Pick<Message, 'id' | 'content' | 'stop_reason'>;

/** Le strict nécessaire du SDK : envoyer un message. Remplaçable dans les tests. */
export interface ClaudeMessagesClient {
  create(params: ClaudeCreateMessageParams): Promise<ClaudeMessage>;
}

export type ClaudeClientOptions = {
  /** Une autre adresse que celle d'Anthropic : un faux serveur HTTP dans les tests. */
  baseUrl?: string;
};

/**
 * Le client réel, sur l'API Messages de `@anthropic-ai/sdk`. Le SDK réessaie de lui-même (deux fois,
 * avec un délai croissant) les pannes passagères : surcharge (529), limite de débit (429), 5xx, réseau.
 */
export function createClaudeMessagesClient(
  apiKey: string,
  options: ClaudeClientOptions = {},
): ClaudeMessagesClient {
  const anthropic = new Anthropic({
    apiKey,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
  });
  return {
    create: async (params) => anthropic.messages.create(params),
  };
}
