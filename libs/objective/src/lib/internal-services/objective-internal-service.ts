import { IdGenerator } from '@org/chore';
import { Objective } from '../models/objective';
import { Task } from '../models/task';
import { ObjectiveRepository } from '../protocols/objective.repository';

export type ObjectiveTreeTaskOutput = {
  id: string;
  title: string;
  importance: number;
  urgency: number;
  done: boolean;
};

export type ObjectiveTreeOutput = {
  id: string;
  title: string;
  description?: string;
  why?: string;
  dueDate?: Date | null;
  tasks: ObjectiveTreeTaskOutput[];
  subObjectives: ObjectiveTreeOutput[];
};

export type CreatedSubObjectiveOutput = {
  id: string;
  title: string;
};

export type CreatedTaskOutput = {
  id: string;
  title: string;
  importance: number;
  urgency: number;
};

/**
 * Façade « système interne » sur le domaine objectif, destinée aux systèmes
 * transverses (ex. les outils de l'assistant IA) et non aux actions métier
 * déclenchées par l'utilisateur — celles-ci passent par les use cases.
 * Convention : on renvoie une valeur simple ou `null`, et on journalise les
 * erreurs sans lever (comme une query).
 *
 * Chaque méthode agit pour un propriétaire : un objectif qui ne lui appartient pas est
 * introuvable, même si l'IA en invente l'id.
 */
export class ObjectiveInternalService {
  constructor(
    private readonly objectiveRepository: ObjectiveRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async getObjectiveTree(objectiveId: string, ownerId: string): Promise<ObjectiveTreeOutput | null> {
    try {
      const objective = await this.objectiveRepository.findById(objectiveId, ownerId);

      if (!objective) {
        return null;
      }

      return this.buildTree(objective);
    } catch (error) {
      console.error('Error occurred while retrieving objective tree:', error);
      return null;
    }
  }

  /**
   * Créer un sous-objectif sous un objectif (ou sous-objectif) parent existant.
   * Renvoie `null` si le parent est introuvable ou si l'enregistrement échoue.
   */
  async createSubObjective(
    parentObjectiveId: string,
    title: string,
    ownerId: string,
  ): Promise<CreatedSubObjectiveOutput | null> {
    try {
      const parent = await this.objectiveRepository.findById(parentObjectiveId, ownerId);

      if (!parent) {
        return null;
      }

      const subObjective = new Objective(this.idGenerator.generateId(), title);
      parent.addSubObjective(subObjective);

      if (!(await this.objectiveRepository.save(parent, ownerId))) {
        return null;
      }

      return { id: subObjective.id, title: subObjective.title };
    } catch (error) {
      console.error('Error occurred while creating sub-objective:', error);
      return null;
    }
  }

  /**
   * Ajouter une tâche à un objectif (ou sous-objectif) existant.
   * Renvoie `null` si l'objectif est introuvable ou si l'enregistrement échoue.
   */
  async addTask(
    objectiveId: string,
    task: { title: string; importance: number; urgency: number },
    ownerId: string,
  ): Promise<CreatedTaskOutput | null> {
    try {
      const objective = await this.objectiveRepository.findById(objectiveId, ownerId);

      if (!objective) {
        return null;
      }

      const newTask = new Task(this.idGenerator.generateId(), task.title, task.importance, task.urgency);
      objective.addTask(newTask);

      if (!(await this.objectiveRepository.save(objective, ownerId))) {
        return null;
      }

      return {
        id: newTask.id,
        title: newTask.title,
        importance: newTask.importance,
        urgency: newTask.urgency,
      };
    } catch (error) {
      console.error('Error occurred while adding task to objective:', error);
      return null;
    }
  }

  private buildTree(objective: Objective): ObjectiveTreeOutput {
    return {
      id: objective.id,
      title: objective.title,
      description: objective.description,
      why: objective.why,
      dueDate: objective.dueDate,
      tasks: objective.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        importance: task.importance,
        urgency: task.urgency,
        done: task.done,
      })),
      subObjectives: objective.subObjectives.map((subObjective) => this.buildTree(subObjective)),
    };
  }
}
