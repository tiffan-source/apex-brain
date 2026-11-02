import { Task } from './task';
import { TodoBase } from './todo-base';

/**
 * Un objectif ou une étape est fait, ou non fait : rien d'autre. Il est fait quand il a au moins un pas et que
 * tous sont faits, sous-étapes comprises. Les étapes n'ont aucun ordre entre elles, les pas non plus : aucune
 * n'en attend une autre.
 */
export function allTasksDone(tasks: readonly { done: boolean }[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.done);
}

export class Objective extends TodoBase {
  private _why?: string;
  private _tasks: Task[] = [];
  private _subObjectives: Objective[] = [];

  // Si on veut garder la trace du parent dans le domaine pour faciliter l'infra
  private _parentId?: string;

  get why(): string | undefined {
    return this._why;
  }

  setWhy(why: string): void {
    this._why = why;
  }

  get tasks(): Task[] {
    return this._tasks;
  }

  addTask(task: Task): void {
    this._tasks.push(task);
    task.setObjectiveId(this.id);
  }

  removeTask(taskId: string): void {
    this._tasks = this._tasks.filter((task) => task.id !== taskId);
  }

  getTaskById(taskId: string): Task | undefined {
    return this._tasks.find((task) => task.id === taskId);
  }

  /** L'objectif ou l'étape de cet arbre (lui compris) qui porte ce pas. */
  findTaskHolder(taskId: string): Objective | undefined {
    if (this.getTaskById(taskId)) {
      return this;
    }

    for (const subObjective of this._subObjectives) {
      const holder = subObjective.findTaskHolder(taskId);
      if (holder) return holder;
    }

    return undefined;
  }

  get subObjectives(): Objective[] {
    return this._subObjectives;
  }

  /** Ses pas et ceux de ses sous-objectifs, à toute profondeur. */
  get allTasks(): Task[] {
    return [...this._tasks, ...this._subObjectives.flatMap((subObjective) => subObjective.allTasks)];
  }

  addSubObjective(subObjective: Objective): void {
    this._subObjectives.push(subObjective);
    subObjective.setParentId(this.id);
  }

  // Règle métier : c'est un objectif principal s'il n'a pas de parent
  get isMainObjective(): boolean {
    return !this._parentId;
  }

  setParentId(parentId: string): void {
    this._parentId = parentId;
  }

  get parentId(): string | undefined {
    return this._parentId;
  }
}
