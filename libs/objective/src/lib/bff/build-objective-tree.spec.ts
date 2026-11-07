import { buildObjectiveTree, FlatTreeObjective, FlatTreeTask } from './build-objective-tree';

const objective = (id: string, parentId: string | null = null, done = false): FlatTreeObjective => ({
  id,
  title: `Objectif ${id}`,
  description: '',
  why: '',
  dueDate: null,
  done,
  parentId,
});

const task = (id: string, objectiveId: string, done = false): FlatTreeTask => ({
  id,
  title: `Pas ${id}`,
  importance: 3,
  urgency: 2,
  done,
  objectiveId,
});

describe('buildObjectiveTree', () => {
  it('emboîte étapes et pas sous qui les porte, objectifs principaux à la racine', () => {
    const tree = buildObjectiveTree(
      [objective('o1'), objective('s1', 'o1'), objective('s2', 's1'), objective('o2')],
      [task('t1', 'o1'), task('t2', 's2', true)],
    );

    expect(tree.objectives.map((node) => node.id)).toEqual(['o1', 'o2']);
    const [o1] = tree.objectives;
    expect(o1.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(o1.subObjectives[0].id).toBe('s1');
    expect(o1.subObjectives[0].subObjectives[0]).toMatchObject({
      id: 's2',
      tasks: [{ id: 't2', done: true }],
      subObjectives: [],
    });
    expect(o1).not.toHaveProperty('parentId');
    expect(o1.tasks[0]).not.toHaveProperty('objectiveId');
  });

  it('garde le `done` lu, sans le recalculer', () => {
    const tree = buildObjectiveTree([objective('o1', null, false)], [task('t1', 'o1', true)]);

    expect(tree.objectives[0].done).toBe(false);
  });

  it("garde l'ordre de lecture", () => {
    const tree = buildObjectiveTree([objective('o1'), objective('b', 'o1'), objective('a', 'o1')], []);

    expect(tree.objectives[0].subObjectives.map((node) => node.id)).toEqual(['b', 'a']);
  });
});
