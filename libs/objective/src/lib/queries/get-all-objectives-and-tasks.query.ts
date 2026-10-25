export type GetAllObjectiveAndTaskInput = {
  ownerId: string;
};

export type TaskOutput = {
  id: string;
  title: string;
  importance: number;
  urgency: number;
  done: boolean;
  objectiveId: string;
};

export type ObjectiveOutput = {
  id: string;
  title: string;
  description: string;
  why: string;
  dueDate: Date | null;
  parentObjective: string | null;
};

export type GetAllObjectiveAndTaskOutput = {
  objectives: ObjectiveOutput[];
  tasks: TaskOutput[];
};

/**
 * Tous les objectifs, étapes et pas de la personne, à plat, dans un ordre stable
 * (création, puis id).
 */
export abstract class GetAllObjectiveAndTaskQuery {
  abstract execute(input: GetAllObjectiveAndTaskInput): Promise<GetAllObjectiveAndTaskOutput>;
}
