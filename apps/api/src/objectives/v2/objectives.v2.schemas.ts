import { z } from 'zod';
import {
  dateInputSchema,
  dateOutputSchema,
  idSchema,
  levelSchema,
  longTextSchema,
  titleSchema,
} from '../../http/schemas';

// Les corps de création (`createObjectiveSchema`, `addSubObjectiveSchema`, `addTaskSchema`) sont ceux
// de la v1 : ils n'ont pas changé.

// #region requêtes

export const renameSchema = z.object({
  title: titleSchema,
});
export type RenameBody = z.infer<typeof renameSchema>;

export const clarifyObjectiveSchema = z
  .object({
    /** Absent : inchangée ; `''` : vidée. */
    description: longTextSchema.optional(),
    /** Absent : inchangé ; `''` : vidé. */
    why: longTextSchema.optional(),
  })
  .refine((body) => body.description !== undefined || body.why !== undefined, {
    message: 'description ou why est requis',
  });
export type ClarifyObjectiveBody = z.infer<typeof clarifyObjectiveSchema>;

export const setObjectiveDeadlineSchema = z.object({
  dueDate: dateInputSchema,
});
export type SetObjectiveDeadlineBody = z.infer<typeof setObjectiveDeadlineSchema>;

export const reprioritizeTaskSchema = z.object({
  importance: levelSchema,
  urgency: levelSchema,
});
export type ReprioritizeTaskBody = z.infer<typeof reprioritizeTaskSchema>;

export const moveTaskSchema = z.object({
  /** L'objectif ou l'étape qui doit porter le pas. */
  objectiveId: idSchema,
});
export type MoveTaskBody = z.infer<typeof moveTaskSchema>;

// #endregion

// #region réponses : l'entité créée ou modifiée, entière, sans ses enfants

export const objectiveCommandResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  why: z.string(),
  dueDate: dateOutputSchema.nullable(),
  /** `null` pour un objectif principal. */
  parentObjectiveId: z.string().nullable(),
  /** Tel qu'enregistré en base : rien ne le tient à jour pour l'instant. */
  done: z.boolean(),
});

export const taskCommandResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  importance: z.number(),
  urgency: z.number(),
  done: z.boolean(),
  /** L'objectif ou l'étape qui porte le pas. */
  objectiveId: z.string(),
});

// #endregion
