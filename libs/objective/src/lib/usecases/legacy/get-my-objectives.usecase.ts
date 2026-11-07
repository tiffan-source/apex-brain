import { Result, runWithResult } from '@org/chore';
import { allTasksDone } from '../../models/objective';
import {
  GetAllObjectiveAndTaskInput,
  GetAllObjectiveAndTaskQuery,
  ObjectiveOutput,
  TaskOutput,
} from '../../queries/get-all-objectives-and-tasks.query';

export type MyObjectiveOutput = ObjectiveOutput & {
  /** Fait ou non fait, rien d'autre : les clients l'affichent sans rien calculer. */
  done: boolean;
};

export type GetMyObjectivesOutput = {
  objectives: MyObjectiveOutput[];
  tasks: TaskOutput[];
};

/** Tous les objectifs, étapes et pas de la personne, à plat, chacun avec son statut fait ou non fait. */
export class GetMyObjectivesUsecase {
  constructor(private readonly query: GetAllObjectiveAndTaskQuery) {}

  async execute(input: GetAllObjectiveAndTaskInput): Promise<Result<GetMyObjectivesOutput>> {
    return runWithResult<GetMyObjectivesOutput>(
      async () => {
        const { objectives, tasks } = await this.query.execute(input);
        const tasksInSubtree = groupTasksBySubtree(objectives, tasks);

        return {
          objectives: objectives.map((objective) => ({
            ...objective,
            done: allTasksDone(tasksInSubtree.get(objective.id) ?? []),
          })),
          tasks,
        };
      },
      [],
      'Failed to get objectives',
    );
  }
}

/** Les pas de chaque objectif et de ses sous-objectifs : chaque pas compte pour tous ses ancêtres. */
function groupTasksBySubtree(
  objectives: readonly ObjectiveOutput[],
  tasks: readonly TaskOutput[],
): Map<string, TaskOutput[]> {
  const parentOf = new Map(objectives.map((objective) => [objective.id, objective.parentObjective]));
  const tasksInSubtree = new Map<string, TaskOutput[]>();

  for (const task of tasks) {
    const seen = new Set<string>();
    let id: string | null | undefined = task.objectiveId;

    while (id && !seen.has(id)) {
      seen.add(id);
      const inSubtree = tasksInSubtree.get(id);
      if (inSubtree) inSubtree.push(task);
      else tasksInSubtree.set(id, [task]);
      id = parentOf.get(id);
    }
  }

  return tasksInSubtree;
}
