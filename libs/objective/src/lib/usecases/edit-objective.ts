import { FailToSaveObjectiveError } from '../errors/fail-to-save-objective.error';
import { ObjectiveNotFoundError } from '../errors/objective-not-found.error';
import { ObjectiveCommandOutput, toObjectiveCommandOutput } from '../mappers/command-output.mapper';
import { Objective } from '../models/objective';
import { ObjectiveRepository } from '../protocols/objective.repository';

/** Les erreurs attendues d'une commande qui modifie un objectif ou une étape. */
export const OBJECTIVE_EDITION_ERRORS = [ObjectiveNotFoundError, FailToSaveObjectiveError];

/**
 * Le geste commun aux commandes qui modifient un objectif ou une étape : le charger au nom de son
 * propriétaire, appliquer le changement, l'enregistrer et rendre l'entité modifiée.
 */
export async function editObjective(
  repository: ObjectiveRepository,
  objectiveId: string,
  ownerId: string,
  change: (objective: Objective) => void,
): Promise<ObjectiveCommandOutput> {
  const objective = await repository.findById(objectiveId, ownerId);

  if (!objective) {
    throw new ObjectiveNotFoundError(objectiveId);
  }

  change(objective);

  if (!(await repository.save(objective, ownerId))) {
    throw new FailToSaveObjectiveError(objective.id);
  }

  return toObjectiveCommandOutput(objective);
}
