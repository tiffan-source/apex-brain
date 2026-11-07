import { Result, runWithResult } from '@org/chore';
import { FailToSaveObjectiveError } from '../errors/fail-to-save-objective.error';
import { ObjectiveNotFoundError } from '../errors/objective-not-found.error';
import { TaskNotFoundError } from '../errors/task-not-found.error';
import { TaskCommandOutput, toTaskCommandOutput } from '../mappers/command-output.mapper';
import { ObjectiveRepository } from '../protocols/objective.repository';

export interface MoveTaskInput {
  taskId: string;
  /** L'objectif ou l'étape qui doit porter le pas : une autre étape, un objectif, un ancêtre… */
  objectiveId: string;
  ownerId: string;
}

/**
 * Déplacer un pas vers un autre objectif ou une autre étape de la personne. Vers l'objectif qui le
 * porte déjà, la commande réussit sans effet.
 */
export class MoveTaskUsecase {
  constructor(private readonly repository: ObjectiveRepository) {}

  execute(input: MoveTaskInput): Promise<Result<TaskCommandOutput>> {
    return runWithResult<TaskCommandOutput>(
      async () => {
        const { taskId, objectiveId, ownerId } = input;

        const currentObjective = await this.repository.findObjectiveWithASpecificTaskId(taskId, ownerId);
        const task = currentObjective?.getTaskById(taskId);

        if (!currentObjective || !task) {
          throw new TaskNotFoundError(taskId);
        }

        if (currentObjective.id === objectiveId) {
          return toTaskCommandOutput(task, objectiveId);
        }

        const targetObjective = await this.repository.findById(objectiveId, ownerId);

        if (!targetObjective) {
          throw new ObjectiveNotFoundError(objectiveId);
        }

        // Remonter un pas vers un ancêtre : l'arbre chargé de l'objectif d'arrivée contient déjà
        // l'étape de départ, avec son propre exemplaire du pas. On l'en retire, sinon l'arbre
        // enregistré porterait deux fois le même pas.
        const holderInTarget = targetObjective.findTaskHolder(taskId);
        holderInTarget?.removeTask(taskId);
        currentObjective.removeTask(taskId);
        targetObjective.addTask(task);

        // `save` ne supprime aucune ligne : tant que l'objectif d'arrivée n'est pas enregistré, le pas
        // reste rattaché à son objectif de départ. Un échec en route laisse donc un état cohérent.
        if (!holderInTarget) {
          await this.saveOrFail(currentObjective.id, () => this.repository.save(currentObjective, ownerId));
        }
        await this.saveOrFail(targetObjective.id, () => this.repository.save(targetObjective, ownerId));

        return toTaskCommandOutput(task, objectiveId);
      },
      [TaskNotFoundError, ObjectiveNotFoundError, FailToSaveObjectiveError],
      'Failed to move task',
    );
  }

  private async saveOrFail(objectiveId: string, save: () => Promise<boolean>): Promise<void> {
    if (!(await save())) {
      throw new FailToSaveObjectiveError(objectiveId);
    }
  }
}
