export type AITool = {
  name: string;
  description: string;
  /** Le schéma JSON des paramètres de l'outil. */
  parameters: object;
};

export type CallResult = {
  id: string;
  functionName: string;
  result: unknown;
};

/**
 * Ce qui accompagne chaque échange avec l'IA. Les instructions système et les outils valent pour
 * un seul échange : ils sont renvoyés à chaque appel, y compris avec les résultats d'outils.
 */
export type InteractionOptions = {
  /** Les instructions système : rôle de l'assistant, contexte, règles. */
  systemInstruction?: string;
  tools?: AITool[];
};

export type GenerateMessageInput = InteractionOptions & {
  prompt: string;
  previousInteractionId?: string;
};

export type AIToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AIInteractionResponse =
  | {
      type: 'message';
      interactionId: string;
      content: string;
    }
  | {
      type: 'tool-call';
      interactionId: string;
      toolCall: AIToolCall[];
    };

/**
 * Capacité générique de génération : une conversation suivie avec une IA capable d'appeler des
 * outils. Ne connaît ni les objectifs, ni les conversations d'Apex.
 *
 * Les implémentations traduisent les erreurs de leur SDK en `AIProviderError`.
 */
export abstract class InteractiveAIProvider {
  abstract generateMessage(input: GenerateMessageInput): Promise<AIInteractionResponse>;

  abstract sendToolCallResult(
    interactionId: string,
    toolCallResult: CallResult[],
    options?: InteractionOptions,
  ): Promise<AIInteractionResponse>;
}
