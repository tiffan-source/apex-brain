/** L'état stocké de cette instance appartient à quelqu'un d'autre : le runtime ne la rend pas. */
export class WorkflowOwnerMismatchError extends Error {
  constructor(readonly key: string) {
    super(`The stored state of workflow ${key} belongs to someone else`);
    this.name = 'WorkflowOwnerMismatchError';
  }
}
