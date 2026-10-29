import {
  AIInteractionResponse,
  AIProviderError,
  AITool,
  CallResult,
  GenerateMessageInput,
  InteractionOptions,
  InteractiveAIProvider,
} from '@org/ai';
import { translateGeminiError } from './gemini-error.translator';
import {
  GeminiCreateInteractionParams,
  GeminiInteraction,
  GeminiInteractionsClient,
} from './gemini-interactions.client';

export type GeminiConfig = {
  /** Le modèle, par exemple `gemini-3.8-flash`. */
  model: string;
};

/** Une interaction terminée sur l'un de ces statuts n'a pas de réponse exploitable. */
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'budget_exceeded']);

/**
 * Gemini (API Interactions) derrière le port `InteractiveAIProvider`. Reprend la logique de l'edge
 * function `httpGeminiInteractiveAiProvider` d'Apex, appelée désormais depuis le serveur.
 *
 * Les instructions système et les outils sont renvoyés à chaque interaction : Gemini ne garde
 * d'une interaction à la suivante que l'historique des échanges.
 */
export class GeminiInteractiveAIProvider implements InteractiveAIProvider {
  constructor(
    private readonly client: GeminiInteractionsClient,
    private readonly config: GeminiConfig,
  ) {}

  async generateMessage(input: GenerateMessageInput): Promise<AIInteractionResponse> {
    return this.interact({
      ...this.common(input),
      input: input.prompt,
      previous_interaction_id: input.previousInteractionId,
    });
  }

  async sendToolCallResult(
    interactionId: string,
    toolCallResult: CallResult[],
    options: InteractionOptions = {},
  ): Promise<AIInteractionResponse> {
    return this.interact({
      ...this.common(options),
      previous_interaction_id: interactionId,
      input: toolCallResult.map((result) => ({
        type: 'function_result' as const,
        name: result.functionName,
        call_id: result.id,
        result: [{ type: 'text' as const, text: JSON.stringify(result.result ?? null) }],
      })),
    });
  }

  private common(
    options: InteractionOptions,
  ): Pick<GeminiCreateInteractionParams, 'model' | 'system_instruction' | 'tools'> {
    return {
      model: this.config.model,
      system_instruction: options.systemInstruction,
      tools: options.tools?.map(toGeminiTool),
    };
  }

  private async interact(params: GeminiCreateInteractionParams): Promise<AIInteractionResponse> {
    let interaction: GeminiInteraction;

    try {
      interaction = await this.client.create(params);
    } catch (error) {
      throw translateGeminiError(error);
    }

    return mapInteraction(interaction);
  }
}

function toGeminiTool(tool: AITool) {
  return {
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

/** Des appels de fonction dans l'interaction : l'IA demande des outils ; sinon, elle répond. */
export function mapInteraction(interaction: GeminiInteraction): AIInteractionResponse {
  if (interaction.status && FAILED_STATUSES.has(interaction.status)) {
    const reasons = (interaction.errors ?? [])
      .map((error) => [error.code, error.message].filter(Boolean).join(': '))
      .filter(Boolean);

    throw new AIProviderError(
      `Gemini interaction ${interaction.id} ended with status ${interaction.status}` +
        (reasons.length > 0 ? `: ${reasons.join('; ')}` : ''),
      {
        status: interaction.status,
      },
    );
  }

  const toolCalls = (interaction.steps ?? [])
    .filter((step) => step.type === 'function_call')
    .map((step) => ({ id: step.id ?? '', name: step.name ?? '', arguments: step.arguments ?? {} }));

  return toolCalls.length > 0
    ? { type: 'tool-call', interactionId: interaction.id, toolCall: toolCalls }
    : { type: 'message', interactionId: interaction.id, content: interaction.output_text ?? '' };
}
