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

export const editObjectiveSchema = z.object({
  title: titleSchema,
  /** Absent : inchangé. */
  description: longTextSchema.optional(),
  /** Absent : inchangé. */
  why: longTextSchema.optional(),
  /** Absent : inchangée ; `null` : l'échéance est retirée. */
  dueDate: dateInputSchema.nullable().optional(),
});
export type EditObjectiveBody = z.infer<typeof editObjectiveSchema>;

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

export const editTaskSchema = z.object({
  title: titleSchema,
  /** L'objectif ou l'étape qui porte le pas : le changer déplace le pas. */
  objectiveId: idSchema,
  importance: levelSchema,
  urgency: levelSchema,
});
export type EditTaskBody = z.infer<typeof editTaskSchema>;

export const taskDoneSchema = z.object({
  done: z.boolean(),
});
export type TaskDoneBody = z.infer<typeof taskDoneSchema>;

// #endregion

// #region réponses (les sorties des cas d'usage, dates en ISO 8601)

export const objectivesResponseSchema = z.object({
  objectives: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      why: z.string(),
      dueDate: dateOutputSchema.nullable(),
      parentObjective: z.string().nullable(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      importance: z.number(),
      urgency: z.number(),
      done: z.boolean(),
      objectiveId: z.string(),
    }),
  ),
});

export const objectiveResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  why: z.string().optional(),
  dueDate: dateOutputSchema.optional(),
});

export const subObjectiveResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
});

export const createdTaskResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  importance: z.number(),
  urgency: z.number(),
});

export const editedTaskResponseSchema = createdTaskResponseSchema.extend({
  objectiveId: z.string(),
});

export const taskDoneResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

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
