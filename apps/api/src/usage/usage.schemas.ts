import { USAGE_PERIODS } from '@org/usage';
import { z } from 'zod';
import { dateOutputSchema } from '../http/schemas';

const action = z.string().meta({ description: "L'action gouvernée, par exemple `assistant.send-message`." });

/** Où en est la personne sur une action gouvernée. */
export const actionUsageSchema = z.discriminatedUnion('access', [
  z.object({ action, access: z.literal('unlimited') }),
  z.object({ action, access: z.literal('denied') }),
  z.object({
    action,
    access: z.literal('limited'),
    /** Le nombre de fois permis par période. */
    quota: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    period: z.enum(USAGE_PERIODS),
    resetsAt: dateOutputSchema.nullable().meta({
      description: 'Le début de la période suivante ; null quand le quota ne repart jamais (lifetime).',
    }),
  }),
]);

export const usageResponseSchema = z.object({
  actions: z
    .array(actionUsageSchema)
    .meta({ description: 'Les actions gouvernées, par ordre de nom. Une action absente est libre.' }),
});

export type UsageResponse = z.infer<typeof usageResponseSchema>;
