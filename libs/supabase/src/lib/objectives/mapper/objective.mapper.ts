import { Objective, ObjectiveOutput, TaskOutput } from '@org/objective';
import { Database } from '../../database.types';
import { TaskMapper, TaskRow } from './task.mapper';

export type ObjectiveRow = Omit<Database['public']['Tables']['objectives']['Row'], 'created_at'>;

export class ObjectiveMapper {
  /** L'objectif, ses pas et tout son sous-arbre chargé, à plat, au nom du propriétaire. */
  static flatten(objective: Objective, userId: string): { objectives: ObjectiveRow[]; tasks: TaskRow[] } {
    const objectives: ObjectiveRow[] = [];
    const tasks: TaskRow[] = [];

    // 1. Extraction de l'objectif courant
    objectives.push({
      id: objective.id,
      user_id: userId,
      title: objective.title,
      description: objective.description ?? null,
      done: objective.done,
      due_date: objective.dueDate ? objective.dueDate.toISOString() : null,
      why: objective.why ?? null,
      parent_id: objective.parentId ?? null,
    });

    // 2. Extraction de ses tâches directes
    for (const task of objective.tasks) {
      tasks.push({ ...TaskMapper.toPersistence(task), user_id: userId, objective_id: objective.id });
    }

    // 3. Parcours récursif des sous-objectifs
    for (const subObjective of objective.subObjectives) {
      const child = ObjectiveMapper.flatten(subObjective, userId);
      objectives.push(...child.objectives);
      tasks.push(...child.tasks);
    }

    return { objectives, tasks };
  }

  static fromRowToObjective(row: ObjectiveRow): Objective {
    const objective = new Objective(row.id, row.title);
    if (row.description) objective.setDescription(row.description);
    if (row.due_date) objective.setDueDate(new Date(row.due_date));
    if (row.why) objective.setWhy(row.why);
    if (row.parent_id) objective.setParentId(row.parent_id);
    objective.setDone(row.done);
    return objective;
  }

  /**
   * Reconstruire l'arbre de l'objectif `targetRootId` à partir de lignes à plat (déjà triées) :
   * les pas rejoignent leur objectif, les étapes leur parent.
   */
  static toDomain(
    flatObjectives: ObjectiveRow[],
    flatTasks: TaskRow[],
    targetRootId: string,
  ): Objective | null {
    if (flatObjectives.length === 0) return null;

    const objectiveMap = new Map<string, Objective>();

    // 1. Instanciation de toutes les entités Objective
    for (const row of flatObjectives) {
      objectiveMap.set(row.id, ObjectiveMapper.fromRowToObjective(row));
    }

    // 2. Instanciation des Task et raccordement à leurs Objective parents
    for (const row of flatTasks) {
      objectiveMap.get(row.objective_id)?.addTask(TaskMapper.toDomain(row));
    }

    // 3. Emboîtement récursif des sous-objectifs (la racine demandée garde son propre parent)
    for (const row of flatObjectives) {
      if (row.id !== targetRootId && row.parent_id && objectiveMap.has(row.parent_id)) {
        objectiveMap.get(row.parent_id)?.addSubObjective(objectiveMap.get(row.id) as Objective);
      }
    }

    // 4. Retourne l'instance de l'objectif racine demandé avec tout son arbre rattaché
    return objectiveMap.get(targetRootId) ?? null;
  }

  static toObjectiveOutput(flatObjectives: ObjectiveRow[]): ObjectiveOutput[] {
    return flatObjectives.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? '',
      why: row.why ?? '',
      dueDate: row.due_date ? new Date(row.due_date) : null,
      parentObjective: row.parent_id,
    }));
  }

  static toTaskOutput(flatTasks: TaskRow[]): TaskOutput[] {
    return flatTasks.map((row) => ({
      id: row.id,
      title: row.title,
      importance: row.importance,
      urgency: row.urgency,
      done: row.done,
      objectiveId: row.objective_id,
    }));
  }
}
