import { TodoBase } from './todo-base';

export class Task extends TodoBase {
  private _importance: number;
  private _urgency: number;

  // L'objectif (ou l'étape) qui porte le pas, posé par `Objective.addTask`
  // comme `parentId` l'est par `Objective.addSubObjective`.
  private _objectiveId?: string;

  constructor(id: string, title: string, importance: number, urgency: number) {
    super(id, title);
    this._importance = importance;
    this._urgency = urgency;
  }

  get importance(): number {
    return this._importance;
  }

  get urgency(): number {
    return this._urgency;
  }

  get objectiveId(): string | undefined {
    return this._objectiveId;
  }

  setImportance(importance: number) {
    this._importance = importance;
    return this;
  }

  setUrgency(urgency: number) {
    this._urgency = urgency;
    return this;
  }

  setObjectiveId(objectiveId: string): void {
    this._objectiveId = objectiveId;
  }
}
