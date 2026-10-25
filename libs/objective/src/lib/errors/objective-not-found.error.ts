import { CoreError } from '@org/chore';

/**
 * L'objectif n'existe pas, ou n'appartient pas à la personne : on ne distingue pas les deux
 * cas, pour ne pas révéler l'existence de l'objectif de quelqu'un d'autre.
 */
export class ObjectiveNotFoundError extends CoreError {
  constructor(objectiveId: string) {
    super('OBJECTIVE_NOT_FOUND', `Objective with ID ${objectiveId} not found`, { objectiveId });
  }
}
