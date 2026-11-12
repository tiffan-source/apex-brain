import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import {
  AIInteractionResponse,
  AIProviderError,
  AITool,
  CallResult,
  GenerateMessageInput,
  InteractionHistory,
  InteractionHistoryRepository,
  InteractionOptions,
  InteractiveAIProvider,
} from '@org/ai';
import { translateClaudeError } from './claude-error.translator';
import { closePendingToolUses, keepRecentTurns } from './claude-history';
import { ClaudeCreateMessageParams, ClaudeMessage, ClaudeMessagesClient } from './claude-messages.client';

/** Le fournisseur inscrit dans les historiques que cet adaptateur écrit. */
export const CLAUDE_PROVIDER = 'claude';

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_HISTORY_BYTES = 200_000;

export type ClaudeConfig = {
  /** Le modèle, par exemple `claude-sonnet-5-5`. */
  model: string;
  /** Le plafond d'une réponse, réflexion comprise, en tokens. Défaut : 8 192. */
  maxTokens?: number;
  /**
   * La taille (en octets de JSON) au-delà de laquelle les tours les plus anciens de la conversation
   * ne sont plus envoyés à Claude. Défaut : 200 000, de l'ordre de 50 000 tokens. Borne le coût d'un
   * appel et la taille d'un historique, loin du million d'octets d'un document Firestore.
   */
  maxHistoryBytes?: number;
  /** Où signaler une conversation qui repart de zéro, faute d'historique. */
  logger?: { warn(message: string): void };
};

/** Une réponse qui s'arrête ainsi est un texte (tronqué, pour `max_tokens`). */
const ANSWER_STOP_REASONS = new Set(['end_turn', 'stop_sequence', 'max_tokens']);

/** Ce qu'une réponse inexploitable veut dire, pour qui lit les logs. */
const UNUSABLE_RESPONSES: Record<string, string> = {
  refusal: 'Claude declined to answer',
  model_context_window_exceeded: 'the conversation no longer fits in the context window of the model',
  max_tokens: 'the response reached max_tokens before any text',
};

/**
 * Claude (API Messages d'Anthropic) derrière le port `InteractiveAIProvider`.
 *
 * L'API Messages ne garde rien d'un appel à l'autre : chaque appel envoie toute la conversation. Sous
 * l'id de chaque message rendu par Claude, qui sert d'id d'interaction au workflow, l'adaptateur
 * range donc tout ce qui a été échangé jusqu'à lui (`InteractionHistoryRepository`), et le relit pour
 * enchaîner l'interaction suivante. Les instructions système et les outils sont envoyés à chaque
 * appel, comme le port le prévoit.
 */
export class ClaudeInteractiveAIProvider implements InteractiveAIProvider {
  private readonly maxTokens: number;
  private readonly maxHistoryBytes: number;

  constructor(
    private readonly client: ClaudeMessagesClient,
    private readonly histories: InteractionHistoryRepository,
    private readonly config: ClaudeConfig,
  ) {
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxHistoryBytes = config.maxHistoryBytes ?? DEFAULT_MAX_HISTORY_BYTES;
  }

  async generateMessage(input: GenerateMessageInput): Promise<AIInteractionResponse> {
    const history = input.previousInteractionId ? await this.continuable(input.previousInteractionId) : [];

    return this.exchange(
      [
        ...history,
        { role: 'user', content: [...closePendingToolUses(history), { type: 'text', text: input.prompt }] },
      ],
      input,
    );
  }

  async sendToolCallResult(
    interactionId: string,
    toolCallResult: CallResult[],
    options: InteractionOptions = {},
  ): Promise<AIInteractionResponse> {
    const history = await this.read(interactionId);

    if (!history) {
      throw new AIProviderError(
        `Claude interaction ${interactionId} has no stored history: the tool results cannot be sent`,
        { interactionId },
      );
    }

    return this.exchange([...history, { role: 'user', content: toolCallResult.map(toToolResult) }], options);
  }

  /**
   * L'historique à poursuivre. Introuvable (interaction de Gemini, stockage en mémoire redémarré),
   * la conversation repart de zéro : l'arbre de l'objectif, lui, se relit avec les outils.
   */
  private async continuable(interactionId: string): Promise<MessageParam[]> {
    const history = await this.read(interactionId);
    if (history) return history;

    this.config.logger?.warn(
      `Claude interaction ${interactionId} has no stored history: the conversation starts over`,
    );
    return [];
  }

  private async read(interactionId: string): Promise<MessageParam[] | null> {
    let history: InteractionHistory | null;

    try {
      history = await this.histories.findById(interactionId);
    } catch (error) {
      throw new AIProviderError(
        `Claude interaction ${interactionId}: the history could not be read: ${messageOf(error)}`,
        { interactionId },
      );
    }

    return history?.provider === CLAUDE_PROVIDER ? (history.messages as MessageParam[]) : null;
  }

  private async exchange(
    messages: MessageParam[],
    options: InteractionOptions,
  ): Promise<AIInteractionResponse> {
    const sent = keepRecentTurns(messages, this.maxHistoryBytes);
    let message: ClaudeMessage;

    try {
      message = await this.client.create(this.request(sent, options));
    } catch (error) {
      throw translateClaudeError(error);
    }

    // Une réponse inexploitable lève ici : rien n'est enregistré, l'interaction précédente reste la bonne.
    const response = mapMessage(message);
    await this.save(message.id, [...sent, ...replyOf(message)]);
    return response;
  }

  private request(messages: MessageParam[], options: InteractionOptions): ClaudeCreateMessageParams {
    return {
      model: this.config.model,
      max_tokens: this.maxTokens,
      messages,
      ...(options.systemInstruction ? { system: options.systemInstruction } : {}),
      ...(options.tools?.length ? { tools: options.tools.map(toClaudeTool) } : {}),
      // Mise en cache jusqu'au dernier bloc : l'appel suivant, qui reprend la même conversation, relit
      // ce préfixe (outils, instructions, échanges) depuis le cache, facturé une fraction du prix.
      cache_control: { type: 'ephemeral' },
    };
  }

  private async save(interactionId: string, messages: MessageParam[]): Promise<void> {
    try {
      await this.histories.save({
        interactionId,
        provider: CLAUDE_PROVIDER,
        messages,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      throw new AIProviderError(
        `Claude interaction ${interactionId}: the history could not be saved: ${messageOf(error)}`,
        { interactionId },
      );
    }
  }
}

/** Des outils demandés : l'IA attend leurs résultats ; sinon, elle répond. */
export function mapMessage(message: ClaudeMessage): AIInteractionResponse {
  const stopReason = message.stop_reason ?? 'null';
  const toolCalls = message.content
    .filter((block): block is ToolUseBlock => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: isRecord(block.input) ? block.input : {},
    }));
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

  if (stopReason === 'tool_use' && toolCalls.length > 0) {
    return { type: 'tool-call', interactionId: message.id, toolCall: toolCalls };
  }

  if (ANSWER_STOP_REASONS.has(stopReason) && (text !== '' || stopReason !== 'max_tokens')) {
    return { type: 'message', interactionId: message.id, content: text };
  }

  throw new AIProviderError(
    `Claude message ${message.id} ended with stop_reason ${stopReason}: ` +
      (UNUSABLE_RESPONSES[stopReason] ?? 'unexpected response'),
    { stopReason },
  );
}

/**
 * La réponse de Claude, telle quelle, pour la suite de la conversation : les blocs de réflexion
 * repartent avec leur signature. Une réponse vide n'est pas gardée (l'API refuse un message vide ;
 * deux messages de la personne qui se suivent, elle les fusionne).
 */
function replyOf(message: ClaudeMessage): MessageParam[] {
  return message.content.length > 0 ? [{ role: 'assistant', content: message.content }] : [];
}

function toClaudeTool(tool: AITool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Tool.InputSchema,
  };
}

function toToolResult(result: CallResult): ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: result.id,
    content: JSON.stringify(result.result ?? null),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
