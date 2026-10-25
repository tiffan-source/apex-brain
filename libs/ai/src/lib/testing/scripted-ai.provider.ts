import {
  AIInteractionResponse,
  CallResult,
  GenerateMessageInput,
  InteractionOptions,
  InteractiveAIProvider,
} from '../protocols/ai.provider';

type ScriptedStep =
  AIInteractionResponse | Error | (() => AIInteractionResponse | Promise<AIInteractionResponse>);

export type RecordedCall =
  | { kind: 'generateMessage'; input: GenerateMessageInput }
  | {
      kind: 'sendToolCallResult';
      interactionId: string;
      toolCallResult: CallResult[];
      options?: InteractionOptions;
    };

/**
 * Une IA dont on écrit les réponses à l'avance, dans l'ordre. Elle garde la trace de chaque appel.
 * Une `Error` dans le script est levée à son tour (une panne de l'IA).
 */
export class ScriptedAIProvider extends InteractiveAIProvider {
  readonly calls: RecordedCall[] = [];
  private readonly script: ScriptedStep[] = [];
  private interactionCounter = 0;

  /** Ajouter des réponses au script. */
  willRespond(...steps: ScriptedStep[]): this {
    this.script.push(...steps);
    return this;
  }

  /** Une réponse texte, avec un nouvel id d'interaction. */
  text(content: string): AIInteractionResponse {
    return { type: 'message', interactionId: this.nextInteractionId(), content };
  }

  /** Une demande d'outils, avec un nouvel id d'interaction. */
  toolCalls(
    ...calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  ): AIInteractionResponse {
    return { type: 'tool-call', interactionId: this.nextInteractionId(), toolCall: calls };
  }

  async generateMessage(input: GenerateMessageInput): Promise<AIInteractionResponse> {
    this.calls.push({ kind: 'generateMessage', input });
    return this.next();
  }

  async sendToolCallResult(
    interactionId: string,
    toolCallResult: CallResult[],
    options?: InteractionOptions,
  ): Promise<AIInteractionResponse> {
    this.calls.push({ kind: 'sendToolCallResult', interactionId, toolCallResult, options });
    return this.next();
  }

  private async next(): Promise<AIInteractionResponse> {
    const step = this.script.shift();
    if (!step) throw new Error('ScriptedAIProvider : plus aucune réponse prévue');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step() : step;
  }

  private nextInteractionId(): string {
    this.interactionCounter += 1;
    return `interaction-${this.interactionCounter}`;
  }
}
