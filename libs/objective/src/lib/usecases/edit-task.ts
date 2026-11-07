import { FailToSaveTaskError } from '../errors/fail-to-save-task.error';
import { TaskNotFoundError } from '../errors/task-not-found.error';
import { TaskCommandOutput, toTaskCommandOutput } from '../mappers/command-output.mapper';
import { Task } from '../models/task';
import { TaskRepository } from '../protocols/task.repository';

/** Les erreurs attendues d'une commande qui modifie un pas sans le déplacer. */
export const TASK_EDITION_ERRORS = [TaskNotFoundError, FailToSaveTaskError];

/**
 * Le geste commun aux commandes qui modifient un pas sans le déplacer : le charger au nom de son
 * propriétaire, appliquer le changement, l'enregistrer et rendre le pas modifié.
 */
export async function editTask(
  repository: TaskRepository,
  taskId: string,
  ownerId: string,
  change: (task: Task) => void,
): Promise<TaskCommandOutput> {
  const task = await repository.findById(taskId, ownerId);

  if (!task) {
    throw new TaskNotFoundError(taskId);
  }

  change(task);

  if (!(await repository.update(task, ownerId))) {
    throw new FailToSaveTaskError(taskId);
  }

  return toTaskCommandOutput(task);
}
