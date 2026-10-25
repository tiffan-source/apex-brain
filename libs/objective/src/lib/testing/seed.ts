import { InMemoryObjectiveDatabase, ObjectiveRow, TaskRow } from './in-memory-objective.database';

/** Poser un objectif (ou une étape) directement en base pour préparer un test. */
export function seedObjective(
  db: InMemoryObjectiveDatabase,
  row: Partial<Omit<ObjectiveRow, 'createdAt'>> & { id: string; ownerId: string },
): void {
  db.upsertObjective({
    title: `Objectif ${row.id}`,
    description: null,
    why: null,
    dueDate: null,
    done: false,
    parentId: null,
    ...row,
  });
}

/** Poser un pas directement en base pour préparer un test. */
export function seedTask(
  db: InMemoryObjectiveDatabase,
  row: Partial<Omit<TaskRow, 'createdAt'>> & { id: string; ownerId: string; objectiveId: string },
): void {
  db.upsertTask({
    title: `Pas ${row.id}`,
    description: null,
    dueDate: null,
    done: false,
    importance: 3,
    urgency: 2,
    ...row,
  });
}
