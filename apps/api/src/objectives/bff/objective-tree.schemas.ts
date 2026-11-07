import { z } from 'zod';
import { dateOutputSchema } from '../../http/schemas';

export const objectiveTreeTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    importance: z.number(),
    urgency: z.number(),
    done: z.boolean(),
  })
  .meta({ id: 'ObjectiveTreeTask' });

export type ObjectiveTreeNodeResponse = {
  id: string;
  title: string;
  description: string;
  why: string;
  dueDate: string | null;
  done: boolean;
  tasks: z.infer<typeof objectiveTreeTaskSchema>[];
  subObjectives: ObjectiveTreeNodeResponse[];
};

/** Un objectif ou une étape, avec ses pas et ses étapes emboîtées (sans ordre, triés par création). */
export const objectiveTreeNodeSchema: z.ZodType<ObjectiveTreeNodeResponse> = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    why: z.string(),
    dueDate: dateOutputSchema.nullable(),
    /** Tel qu'enregistré en base : rien ne le tient à jour pour l'instant (`false` par défaut). */
    done: z.boolean(),
    tasks: z.array(objectiveTreeTaskSchema),
    get subObjectives() {
      return z.array(objectiveTreeNodeSchema);
    },
  })
  .meta({ id: 'ObjectiveTreeNode' });

export const objectiveTreeResponseSchema = z.object({
  /** Les objectifs principaux, chacun avec tout son arbre. */
  objectives: z.array(objectiveTreeNodeSchema),
});
