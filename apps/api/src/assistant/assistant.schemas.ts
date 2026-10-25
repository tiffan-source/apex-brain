import { z } from 'zod';
import { dateOutputSchema } from '../http/schemas';

export const sendMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
});
export type SendMessageBody = z.infer<typeof sendMessageSchema>;

export const permissionSchema = z.object({
  /** `true` : l'outil s'exécute ; `false` : il est annulé et l'IA en est informée. */
  granted: z.boolean(),
  /** L'outil auquel on répond : une réponse à une demande déjà passée est refusée (409). */
  toolCallId: z.string().min(1).optional(),
});
export type PermissionBody = z.infer<typeof permissionSchema>;

const workflowValueSchema: z.ZodType<string | { [step: string]: unknown }> = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
]);

export const workflowStateResponseSchema = z.object({
  objectiveId: z.string(),
  /** La valeur de la machine XState (`Ready For New Message`, `{ ExecutingAllTool: … }`…). */
  value: workflowValueSchema,
  status: z.enum(['ready', 'processing', 'awaiting-permission']),
  pendingToolCall: z
    .object({
      id: z.string(),
      name: z.string(),
      arguments: z.unknown(),
    })
    .nullable(),
  lastRegisteredMessage: z
    .object({
      id: z.string(),
      content: z.string(),
      sender: z.string(),
      createdAt: dateOutputSchema,
    })
    .nullable(),
  lastError: z
    .object({
      code: z.string(),
      step: z.string(),
      at: z.string(),
    })
    .nullable(),
});
