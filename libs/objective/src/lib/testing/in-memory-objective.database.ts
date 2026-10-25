import { Objective } from '../models/objective';
import { Task } from '../models/task';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { TaskRepository } from '../protocols/task.repository';
import {
  GetAllObjectiveAndTaskInput,
  GetAllObjectiveAndTaskOutput,
  GetAllObjectiveAndTaskQuery,
} from '../queries/get-all-objectives-and-tasks.query';

export type ObjectiveRow = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  why: string | null;
  dueDate: Date | null;
  done: boolean;
  parentId: string | null;
  createdAt: number;
};

export type TaskRow = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  done: boolean;
  importance: number;
  urgency: number;
  objectiveId: string;
  createdAt: number;
};

/**
 * Une base en mémoire qui se comporte comme les adaptateurs Supabase : lignes à plat,
 * filtre par propriétaire, upsert qui refuse d'écraser la ligne de quelqu'un d'autre,
 * lecture dans l'ordre de création.
 */
export class InMemoryObjectiveDatabase {
  readonly objectives = new Map<string, ObjectiveRow>();
  readonly tasks = new Map<string, TaskRow>();

  /** Fait échouer les prochaines écritures (le `save` rend `false`). */
  failWrites = false;

  private clock = 0;
  private readonly objectiveCreatedListeners: Array<(row: ObjectiveRow) => void> = [];

  /** Être prévenu à la création d'un objectif (comme le trigger qui crée sa conversation). */
  onObjectiveCreated(listener: (row: ObjectiveRow) => void): void {
    this.objectiveCreatedListeners.push(listener);
  }

  tick(): number {
    this.clock += 1;
    return this.clock;
  }

  upsertObjective(row: Omit<ObjectiveRow, 'createdAt'>): void {
    const existing = this.objectives.get(row.id);
    this.objectives.set(row.id, { ...row, createdAt: existing?.createdAt ?? this.tick() });
    if (!existing) {
      const created = this.objectives.get(row.id) as ObjectiveRow;
      this.objectiveCreatedListeners.forEach((listener) => listener(created));
    }
  }

  upsertTask(row: Omit<TaskRow, 'createdAt'>): void {
    const existing = this.tasks.get(row.id);
    this.tasks.set(row.id, { ...row, createdAt: existing?.createdAt ?? this.tick() });
  }

  objectivesOf(ownerId: string): ObjectiveRow[] {
    return [...this.objectives.values()].filter((row) => row.ownerId === ownerId).sort(byCreation);
  }

  tasksOf(ownerId: string): TaskRow[] {
    return [...this.tasks.values()].filter((row) => row.ownerId === ownerId).sort(byCreation);
  }

  toObjective(row: ObjectiveRow): Objective {
    const objective = new Objective(row.id, row.title);
    if (row.description) objective.setDescription(row.description);
    if (row.why) objective.setWhy(row.why);
    if (row.dueDate) objective.setDueDate(row.dueDate);
    if (row.parentId) objective.setParentId(row.parentId);
    objective.setDone(row.done);
    return objective;
  }

  toTask(row: TaskRow): Task {
    const task = new Task(row.id, row.title, row.importance, row.urgency);
    if (row.description) task.setDescription(row.description);
    if (row.dueDate) task.setDueDate(row.dueDate);
    task.setObjectiveId(row.objectiveId);
    task.setDone(row.done);
    return task;
  }
}

const byCreation = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id);

export class InMemoryObjectiveRepository extends ObjectiveRepository {
  constructor(private readonly db: InMemoryObjectiveDatabase) {
    super();
  }

  async save(objective: Objective, ownerId: string): Promise<boolean> {
    if (this.db.failWrites) return false;

    const objectiveRows: Array<Omit<ObjectiveRow, 'createdAt'>> = [];
    const taskRows: Array<Omit<TaskRow, 'createdAt'>> = [];
    flatten(objective, ownerId, objectiveRows, taskRows);

    // Comme Postgres (« ON CONFLICT DO UPDATE command cannot affect row a second time ») : un même
    // id deux fois dans une écriture la fait échouer.
    if (hasDuplicateIds(objectiveRows) || hasDuplicateIds(taskRows)) return false;

    // Comme l'adaptateur Supabase : jamais d'écriture sur la ligne d'un autre propriétaire.
    const foreign =
      objectiveRows.some((row) => this.ownedByAnother(this.db.objectives.get(row.id), ownerId)) ||
      taskRows.some((row) => this.ownedByAnother(this.db.tasks.get(row.id), ownerId));
    if (foreign) return false;

    objectiveRows.forEach((row) => this.db.upsertObjective(row));
    taskRows.forEach((row) => this.db.upsertTask(row));
    return true;
  }

  async findById(id: string, ownerId: string): Promise<Objective | null> {
    const rows = this.db.objectivesOf(ownerId);
    if (!rows.some((row) => row.id === id)) return null;

    const objectives = new Map(rows.map((row) => [row.id, this.db.toObjective(row)]));
    const subtree = collectSubtree(id, rows);

    for (const row of this.db.tasksOf(ownerId)) {
      if (subtree.has(row.objectiveId)) objectives.get(row.objectiveId)?.addTask(this.db.toTask(row));
    }
    for (const row of rows) {
      if (subtree.has(row.id) && row.id !== id && row.parentId) {
        objectives.get(row.parentId)?.addSubObjective(objectives.get(row.id) as Objective);
      }
    }
    return objectives.get(id) ?? null;
  }

  async findObjectiveWithASpecificTaskId(taskId: string, ownerId: string): Promise<Objective | null> {
    const task = this.db.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId) return null;

    const row = this.db.objectives.get(task.objectiveId);
    if (!row || row.ownerId !== ownerId) return null;

    const objective = this.db.toObjective(row);
    for (const taskRow of this.db.tasksOf(ownerId)) {
      if (taskRow.objectiveId === row.id) objective.addTask(this.db.toTask(taskRow));
    }
    return objective;
  }

  private ownedByAnother(row: { ownerId: string } | undefined, ownerId: string): boolean {
    return row !== undefined && row.ownerId !== ownerId;
  }
}

export class InMemoryTaskRepository extends TaskRepository {
  constructor(private readonly db: InMemoryObjectiveDatabase) {
    super();
  }

  async findById(taskId: string, ownerId: string): Promise<Task | null> {
    const row = this.db.tasks.get(taskId);
    return row && row.ownerId === ownerId ? this.db.toTask(row) : null;
  }

  async update(task: Task, ownerId: string): Promise<boolean> {
    if (this.db.failWrites) return false;

    const row = this.db.tasks.get(task.id);
    if (!row || row.ownerId !== ownerId) return false;

    this.db.upsertTask({
      ...row,
      title: task.title,
      description: task.description ?? null,
      dueDate: task.dueDate ?? null,
      done: task.done,
      importance: task.importance,
      urgency: task.urgency,
    });
    return true;
  }

  async getAllUserTasks(userId: string): Promise<Task[]> {
    return this.db.tasksOf(userId).map((row) => this.db.toTask(row));
  }
}

export class InMemoryGetAllObjectiveAndTaskQuery extends GetAllObjectiveAndTaskQuery {
  constructor(private readonly db: InMemoryObjectiveDatabase) {
    super();
  }

  async execute(input: GetAllObjectiveAndTaskInput): Promise<GetAllObjectiveAndTaskOutput> {
    return {
      objectives: this.db.objectivesOf(input.ownerId).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? '',
        why: row.why ?? '',
        dueDate: row.dueDate,
        parentObjective: row.parentId,
      })),
      tasks: this.db.tasksOf(input.ownerId).map((row) => ({
        id: row.id,
        title: row.title,
        importance: row.importance,
        urgency: row.urgency,
        done: row.done,
        objectiveId: row.objectiveId,
      })),
    };
  }
}

/** Tout le nécessaire pour un test : la base et les trois adaptateurs qui la partagent. */
export function createInMemoryObjectiveInfrastructure() {
  const db = new InMemoryObjectiveDatabase();
  return {
    db,
    objectiveRepository: new InMemoryObjectiveRepository(db),
    taskRepository: new InMemoryTaskRepository(db),
    getAllObjectiveAndTaskQuery: new InMemoryGetAllObjectiveAndTaskQuery(db),
  };
}

function flatten(
  objective: Objective,
  ownerId: string,
  objectiveRows: Array<Omit<ObjectiveRow, 'createdAt'>>,
  taskRows: Array<Omit<TaskRow, 'createdAt'>>,
): void {
  objectiveRows.push({
    id: objective.id,
    ownerId,
    title: objective.title,
    description: objective.description ?? null,
    why: objective.why ?? null,
    dueDate: objective.dueDate ?? null,
    done: objective.done,
    parentId: objective.parentId ?? null,
  });

  for (const task of objective.tasks) {
    taskRows.push({
      id: task.id,
      ownerId,
      title: task.title,
      description: task.description ?? null,
      dueDate: task.dueDate ?? null,
      done: task.done,
      importance: task.importance,
      urgency: task.urgency,
      objectiveId: objective.id,
    });
  }

  for (const subObjective of objective.subObjectives) {
    flatten(subObjective, ownerId, objectiveRows, taskRows);
  }
}

function hasDuplicateIds(rows: Array<{ id: string }>): boolean {
  return new Set(rows.map((row) => row.id)).size !== rows.length;
}

function collectSubtree(rootId: string, rows: ObjectiveRow[]): Set<string> {
  const subtree = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (row.parentId && subtree.has(row.parentId) && !subtree.has(row.id)) {
        subtree.add(row.id);
        grew = true;
      }
    }
  }
  return subtree;
}
