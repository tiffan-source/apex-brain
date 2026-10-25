import { Result, runWithResult } from '@org/chore';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { TaskNotFoundError } from '../errors/task-not-found.error';
import { ObjectiveNotFoundError } from '../errors/objective-not-found.error';
import { FailToSaveObjectiveError } from '../errors/fail-to-save-objective.error';

export interface EditMyTaskInput {
  task: {
    id: string;
    title: string;
    /** L'objectif ou l'étape qui doit porter le pas : le changer déplace le pas. */
    objectiveId: string;
    importance: number;
    urgency: number;
  };
  ownerId: string;
}

export interface EditMyTaskOutput {
  id: string;
  title: string;
  objectiveId: string;
  importance: number;
  urgency: number;
}

export class EditMyTaskUsecase {
  constructor(private readonly objectiveRepository: ObjectiveRepository) {}

  async execute(input: EditMyTaskInput): Promise<Result<EditMyTaskOutput>> {
    return runWithResult<EditMyTaskOutput>(
      async () => {
        const { id, title, objectiveId, importance, urgency } = input.task;

        const currentObjective = await this.objectiveRepository.findObjectiveWithASpecificTaskId(
          id,
          input.ownerId,
        );
        const task = currentObjective?.getTaskById(id);

        if (!currentObjective || !task) {
          throw new TaskNotFoundError(id);
        }

        task.setTitle(title);
        task.setImportance(importance);
        task.setUrgency(urgency);

        if (currentObjective.id !== objectiveId) {
          const targetObjective = await this.objectiveRepository.findById(objectiveId, input.ownerId);

          if (!targetObjective) {
            throw new ObjectiveNotFoundError(objectiveId);
          }

          // Remonter un pas vers un ancêtre : l'arbre chargé de l'objectif d'arrivée contient déjà
          // l'étape de départ, avec son propre exemplaire du pas. On l'en retire, sinon l'arbre
          // enregistré porterait deux fois le même pas (dans Apex, l'enregistrement échouait).
          const holderInTarget = targetObjective.findTaskHolder(id);
          holderInTarget?.removeTask(id);
          currentObjective.removeTask(id);
          targetObjective.addTask(task);

          // `save` ne supprime aucune ligne : tant que l'objectif d'arrivée n'est pas enregistré,
          // le pas reste rattaché à son objectif de départ. Un échec en route laisse donc un état cohérent.
          if (!holderInTarget) {
            await this.saveOrFail(currentObjective.id, () =>
              this.objectiveRepository.save(currentObjective, input.ownerId),
            );
          }
          await this.saveOrFail(targetObjective.id, () =>
            this.objectiveRepository.save(targetObjective, input.ownerId),
          );
        } else {
          await this.saveOrFail(currentObjective.id, () =>
            this.objectiveRepository.save(currentObjective, input.ownerId),
          );
        }

        return {
          id: task.id,
          title: task.title,
          objectiveId,
          importance: task.importance,
          urgency: task.urgency,
        };
      },
      [TaskNotFoundError, ObjectiveNotFoundError, FailToSaveObjectiveError],
      'Failed to edit task',
    );
  }

  private async saveOrFail(objectiveId: string, save: () => Promise<boolean>): Promise<void> {
    if (!(await save())) {
      throw new FailToSaveObjectiveError(objectiveId);
    }
  }
}
