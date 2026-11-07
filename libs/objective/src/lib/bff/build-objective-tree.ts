import { GetObjectiveTreeOutput, ObjectiveTreeNode, ObjectiveTreeTask } from './get-objective-tree.query';

/** Un objectif ou une étape, à plat, tel qu'un adaptateur le lit. */
export type FlatTreeObjective = Omit<ObjectiveTreeNode, 'tasks' | 'subObjectives'> & {
  parentId: string | null;
};

/** Un pas, à plat, tel qu'un adaptateur le lit. */
export type FlatTreeTask = ObjectiveTreeTask & { objectiveId: string };

/**
 * Emboîter des lignes à plat (déjà triées) en arbre : chaque pas sous qui le porte, chaque étape
 * sous son parent. Une ligne dont le parent est absent de la lecture est ignorée.
 */
export function buildObjectiveTree(
  objectives: readonly FlatTreeObjective[],
  tasks: readonly FlatTreeTask[],
): GetObjectiveTreeOutput {
  const nodes = new Map<string, ObjectiveTreeNode>();

  for (const { parentId: _parentId, ...objective } of objectives) {
    nodes.set(objective.id, { ...objective, tasks: [], subObjectives: [] });
  }

  for (const { objectiveId, ...task } of tasks) {
    nodes.get(objectiveId)?.tasks.push(task);
  }

  const roots: ObjectiveTreeNode[] = [];
  for (const objective of objectives) {
    const node = nodes.get(objective.id) as ObjectiveTreeNode;
    if (!objective.parentId) roots.push(node);
    else nodes.get(objective.parentId)?.subObjectives.push(node);
  }

  return { objectives: roots };
}
