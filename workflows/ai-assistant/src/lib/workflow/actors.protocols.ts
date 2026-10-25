import { z } from 'zod';

// #region ai actors protocols

export type TextResponse = {
  responseType: 'text';
  response: string;
};

export type ToolCallResponse = {
  responseType: 'toolCall';
  toolCalls: ToolCall[];
};

/** Ce que l'IA a répondu : un texte, ou des outils à exécuter. */
export type AIResponseContent = TextResponse | ToolCallResponse;

export type AIResponse = {
  /** L'id de l'interaction chez le fournisseur d'IA, pour enchaîner la suivante. */
  id: string;
  response: AIResponseContent;
};

export const textResponse = (text: string): TextResponse => ({ responseType: 'text', response: text });

export const toolCallResponse = (toolCalls: ToolCall[]): ToolCallResponse => ({
  responseType: 'toolCall',
  toolCalls,
});

export type GetAIMessageInput = {
  prompt: string;
  previousInteractionId?: string;
  tools?: Tool[];
  systemInstruction?: string;
};

export type SendToolCallResultInput = {
  interactionId: string;
  toolCallResult: CallResult[];
  /** Les outils et les instructions valent pour un seul échange : ils sont renvoyés avec les résultats. */
  tools?: Tool[];
  systemInstruction?: string;
};

export abstract class IAIActor {
  abstract getAIMessage(input: GetAIMessageInput): Promise<AIResponse>;
  abstract sendToolCallResult(input: SendToolCallResultInput): Promise<AIResponse>;
}

// #endregion

// #region chat actors protocols

/**
 * A message that has been persisted in a conversation, as reported back by the
 * chat actor once it owns a real id. The UI uses it to display the message
 * without having to reload the whole conversation.
 */
export type RegisteredMessage = {
  id: string;
  content: string;
  sender: string;
  createdAt: Date;
};

export type RegisterMessageResult = {
  success: boolean;
  message: RegisteredMessage | null;
};

export type RegisterMessageInput = {
  /** La référence de la conversation : l'id de l'objectif. */
  conversationExternalRef: string;
  /** La personne propriétaire de la conversation. */
  ownerId: string;
  /** L'auteur du message : la personne, ou l'assistant. */
  senderId: string;
  /** Posé avant l'écriture : rejouer l'écriture avec le même id ne double pas le message. */
  messageId: string;
  content: string;
};

export abstract class IChatActor {
  abstract registerMessage(input: RegisterMessageInput): Promise<RegisterMessageResult>;

  /** La personne a-t-elle une conversation rattachée à cette référence ? */
  abstract hasConversation(conversationExternalRef: string, ownerId: string): Promise<boolean>;
}

// #endregion

// #region tool actors protocols

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface CallResult {
  id: string;
  functionName: string;
  result: unknown;
}

export interface ToolExecutionContext {
  userId: string;
  objectiveId: string;
}

export interface Tool<TInput extends z.ZodType = z.ZodType, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TInput;
  /**
   * Outil qui modifie les données : son exécution requiert une confirmation
   * explicite de l'utilisateur (policy `ask-user`). Absent/`false` = lecture,
   * exécution directe.
   */
  readonly requiresPermission?: boolean;

  execute(context: ToolExecutionContext, input: z.infer<TInput>): Promise<TOutput>;
}

export abstract class IToolExecutor {
  abstract execute(toolCall: ToolCall, context: ToolExecutionContext): Promise<CallResult>;
}

export type ToolExecutionDecision =
  | {
      type: 'execute';
    }
  | {
      type: 'ask-user';
      reason: string;
    }
  | {
      type: 'deny';
      reason: string;
    };

export abstract class IToolExecutionPolicy {
  abstract decide(
    tool: ToolCall,
    context: ToolExecutionContext,
    input: unknown,
  ): Promise<ToolExecutionDecision>;
}

export abstract class IToolRegistry {
  abstract get(name: string): Tool;

  abstract getAll(): Tool[];
}

// #endregion
