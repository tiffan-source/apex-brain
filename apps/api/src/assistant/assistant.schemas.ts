import { WORKFLOW_ACTIVITY_STEPS } from '@org/ai-assistant';
import { AKARI_WINDOWS } from '@org/akari-access';
import { z } from 'zod';
import { apiErrorSchema, dateOutputSchema } from '../http/schemas';

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

const workflowActivityStepSchema = z.enum(WORKFLOW_ACTIVITY_STEPS);

export const workflowStateResponseSchema = z.object({
  objectiveId: z.string(),
  /** Déprécié : la valeur de la machine XState. Les clients lisent `activity`. */
  value: workflowValueSchema,
  status: z.enum(['ready', 'processing', 'awaiting-permission']),
  /** Ce que fait l'assistant pendant un tour ; null au repos. */
  activity: z
    .object({
      step: workflowActivityStepSchema,
      elapsedMs: z.number().int().nonnegative(),
      round: z.number().int().nonnegative(),
      done: z.array(workflowActivityStepSchema),
    })
    .nullable(),
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

/** Le quota d'Akari épuisé : la limite, ce qui est déjà compté, la fenêtre, sa remise à zéro. */
export const akariQuotaExceededDetailsSchema = z.object({
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  window: z.enum(AKARI_WINDOWS),
  /** `null` pour la fenêtre `total`, qui ne se remet jamais à zéro. */
  resetsAt: dateOutputSchema.nullable(),
});

export const akariQuotaExceededErrorSchema = z.object({
  error: z.object({
    code: z.literal('AKARI_QUOTA_EXCEEDED'),
    message: z.string(),
    details: akariQuotaExceededDetailsSchema,
  }),
});

/** Les 403 de l'envoi d'un message : `FORBIDDEN`, ou `AKARI_QUOTA_EXCEEDED` avec ses détails. */
export const sendMessageForbiddenSchema = z.union([akariQuotaExceededErrorSchema, apiErrorSchema]);
