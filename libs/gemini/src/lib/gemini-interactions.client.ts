import { GoogleGenAI, Interactions } from '@google/genai';

/** Les paramètres d'une interaction avec un modèle, tels que le SDK les attend. */
export type GeminiCreateInteractionParams =
  Interactions.InteractionCreateParams.CreateModelInteractionParamsNonStreaming;

/** Ce que l'adaptateur lit d'une interaction rendue par Gemini. */
export type GeminiInteraction = {
  id: string;
  status?: string;
  steps?: Array<{ type: string; id?: string; name?: string; arguments?: Record<string, unknown> }>;
  output_text?: string;
  /** Les pannes que Gemini a notées sur l'interaction, quand elle échoue. */
  errors?: Array<{ code?: string; message?: string }>;
};

/** Le strict nécessaire du SDK : créer une interaction. Remplaçable dans les tests. */
export interface GeminiInteractionsClient {
  create(params: GeminiCreateInteractionParams): Promise<GeminiInteraction>;
}

export type GeminiClientOptions = {
  /** Une autre adresse que celle de Gemini : un faux serveur HTTP dans les tests. */
  baseUrl?: string;
};

/** Le client réel, sur l'API Interactions de `@google/genai`. */
export function createGeminiInteractionsClient(
  apiKey: string,
  options: GeminiClientOptions = {},
): GeminiInteractionsClient {
  const ai = new GoogleGenAI({
    apiKey,
    ...(options.baseUrl ? { httpOptions: { baseUrl: options.baseUrl } } : {}),
  });
  return {
    create: async (params) => ai.interactions.create(params),
  };
}
