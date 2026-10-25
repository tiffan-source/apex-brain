import { AIInteractionResponse, AITool, InteractiveAIProvider } from '@org/ai';
import { z } from 'zod';
import {
  AIResponse,
  GetAIMessageInput,
  IAIActor,
  SendToolCallResultInput,
  textResponse,
  Tool,
  toolCallResponse,
} from '../workflow/actors.protocols';

/** L'acteur IA du workflow, branché sur la capacité générique de `@org/ai`. */
export class AIService implements IAIActor {
  constructor(private readonly aiProvider: InteractiveAIProvider) {}

  async getAIMessage(input: GetAIMessageInput): Promise<AIResponse> {
    const result = await this.aiProvider.generateMessage({
      prompt: input.prompt,
      previousInteractionId: input.previousInteractionId,
      tools: toAITools(input.tools),
      systemInstruction: input.systemInstruction,
    });

    return buildAiResponse(result);
  }

  async sendToolCallResult(input: SendToolCallResultInput): Promise<AIResponse> {
    const result = await this.aiProvider.sendToolCallResult(input.interactionId, input.toolCallResult, {
      tools: toAITools(input.tools),
      systemInstruction: input.systemInstruction,
    });

    return buildAiResponse(result);
  }
}

function toAITools(tools: Tool[] | undefined): AITool[] | undefined {
  return tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema),
  }));
}

function buildAiResponse(response: AIInteractionResponse): AIResponse {
  if (response.type === 'message') {
    return { id: response.interactionId, response: textResponse(response.content) };
  }

  return {
    id: response.interactionId,
    response: toolCallResponse(
      response.toolCall.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    ),
  };
}
