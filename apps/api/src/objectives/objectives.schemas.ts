import { z } from 'zod';
import {
  dateInputSchema,
  dateOutputSchema,
  idSchema,
  levelSchema,
  longTextSchema,
  titleSchema,
} from '../http/schemas';

export const objectiveIdParam = idSchema;
export const taskIdParam = idSchema;

// #region requêtes

export const createObjectiveSchema = z.object({
  title: titleSchema,
  description: longTextSchema.optional(),
  why: longTextSchema.optional(),
  dueDate: dateInputSchema.optional(),
});
export type CreateObjectiveBody = z.infer<typeof createObjectiveSchema>;

export const addSubObjectiveSchema = z.object({
  title: titleSchema,
});
export type AddSubObjectiveBody = z.infer<typeof addSubObjectiveSchema>;

export const addTaskSchema = z.object({
  title: titleSchema,
  importance: levelSchema,
  urgency: levelSchema,
});
export type AddTaskBody = z.infer<typeof addTaskSchema>;

// #endregion

// #region réponses (dates en ISO 8601)

export const todayFocusResponseSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    objectiveId: z.string(),
    important: z.number(),
    urgent: z.number(),
    dueDate: dateOutputSchema.optional(),
    done: z.boolean(),
  }),
);

// #endregion
