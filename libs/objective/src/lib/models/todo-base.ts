export class TodoBase {
  private readonly _id: string;
  private _title: string;
  private _done = false;
  private _description?: string;
  private _dueDate?: Date;

  constructor(id: string, title: string) {
    this._id = id;
    this._title = title;
  }

  get id(): string {
    return this._id;
  }

  get title(): string {
    return this._title;
  }

  get done(): boolean {
    return this._done;
  }

  get dueDate(): Date | undefined {
    return this._dueDate;
  }

  get description(): string | undefined {
    return this._description;
  }

  setTitle(title: string): void {
    this._title = title;
  }

  setDescription(description: string): void {
    this._description = description;
  }

  setDueDate(dueDate: Date): void {
    this._dueDate = dueDate;
  }

  /** Retirer l'échéance. */
  clearDueDate(): void {
    this._dueDate = undefined;
  }

  setDone(done: boolean) {
    this._done = done;
    return this;
  }
}
