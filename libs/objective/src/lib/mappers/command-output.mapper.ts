import { Objective } from '../models/objective';
import { Task } from '../models/task';

/**
 * Ce que rend toute commande qui crée ou modifie un objectif ou une étape : l'entité entière, sans
 * ses étapes ni ses pas. Le client la remplace dans son arbre en cache (optimistic update) sans
 * relire l'arbre complet.
 */
export type ObjectiveCommandOutput = {
  id: string;
  title: string;
  description: string;
  why: string;
  dueDate: Date | null;
  /** `null` pour un objectif principal. */
  parentObjectiveId: string | null;
  /** Tel qu'enregistré en base : rien ne le tient à jour pour l'instant (docs/adr/0006). */
  done: boolean;
};

/** Ce que rend toute commande qui crée ou modifie un pas : le pas entier. */
export type TaskCommandOutput = {
  id: string;
  title: string;
  importance: number;
  urgency: number;
  done: boolean;
  /** L'objectif ou l'étape qui porte le pas. */
  objectiveId: string;
};

export function toObjectiveCommandOutput(objective: Objective): ObjectiveCommandOutput {
  return {
    id: objective.id,
    title: objective.title,
    description: objective.description ?? '',
    why: objective.why ?? '',
    dueDate: objective.dueDate ?? null,
    parentObjectiveId: objective.parentId ?? null,
    done: objective.done,
  };
}

/** `objectiveId` : celui qui porte le pas, quand le pas chargé ne le connaît pas encore. */
export function toTaskCommandOutput(task: Task, objectiveId = task.objectiveId ?? ''): TaskCommandOutput {
  return {
    id: task.id,
    title: task.title,
    importance: task.importance,
    urgency: task.urgency,
    done: task.done,
    objectiveId,
  };
}
