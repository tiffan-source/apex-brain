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
};

/** Le strict nécessaire du SDK : créer une interaction. Remplaçable dans les tests. */
export interface GeminiInteractionsClient {
  create(params: GeminiCreateInteractionParams): Promise<GeminiInteraction>;
}

/** Le client réel, sur l'API Interactions de `@google/genai`. */
export function createGeminiInteractionsClient(apiKey: string): GeminiInteractionsClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    create: async (params) => ai.interactions.create(params),
  };
}
