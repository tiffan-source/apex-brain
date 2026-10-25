import { z } from 'zod';
import {
  CallResult,
  IToolExecutor,
  IToolRegistry,
  ToolCall,
  ToolExecutionContext,
} from '../workflow/actors.protocols';

export class ToolExecutor implements IToolExecutor {
  constructor(private readonly registry: IToolRegistry) {}

  async execute(toolCall: ToolCall, context: ToolExecutionContext): Promise<CallResult> {
    const tool = this.registry.get(toolCall.name);
    const parsed = tool.inputSchema.safeParse(toolCall.arguments);

    // Des arguments mal formés ne sont pas une panne : l'IA reçoit ce qui ne va pas et peut se corriger.
    if (!parsed.success) {
      return {
        id: toolCall.id,
        functionName: tool.name,
        result: {
          error: 'INVALID_ARGUMENTS',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    }

    const result = await tool.execute(context, parsed.data as z.infer<typeof tool.inputSchema>);

    return { id: toolCall.id, functionName: tool.name, result };
  }
}
