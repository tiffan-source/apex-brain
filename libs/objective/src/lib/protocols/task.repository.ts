import { Task } from '../models/task';

/**
 * Port de persistance des pas, filtré par propriétaire comme `ObjectiveRepository`.
 */
export abstract class TaskRepository {
  abstract findById(taskId: string, ownerId: string): Promise<Task | null>;

  /** Rend `false` si l'enregistrement n'a pas abouti (dont : pas introuvable pour ce propriétaire). */
  abstract update(task: Task, ownerId: string): Promise<boolean>;

  /** Tous les pas de la personne, avec leur `objectiveId`. */
  abstract getAllUserTasks(userId: string): Promise<Task[]>;
}
