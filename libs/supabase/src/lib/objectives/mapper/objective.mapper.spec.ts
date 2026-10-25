import { Objective, Task } from '@org/objective';
import { ObjectiveMapper, ObjectiveRow } from './objective.mapper';
import { TaskRow } from './task.mapper';

const objectiveRow = (row: Partial<ObjectiveRow> & { id: string }): ObjectiveRow => ({
  user_id: 'alice',
  title: `Objectif ${row.id}`,
  description: null,
  done: false,
  due_date: null,
  why: null,
  parent_id: null,
  ...row,
});

const taskRow = (row: Partial<TaskRow> & { id: string; objective_id: string }): TaskRow => ({
  user_id: 'alice',
  title: `Pas ${row.id}`,
  description: null,
  done: false,
  due_date: null,
  importance: 3,
  urgency: 2,
  ...row,
});

describe('ObjectiveMapper', () => {
  it("met à plat un arbre au nom du propriétaire, et le reconstruit à l'identique", () => {
    const root = new Objective('o1', 'Courir un marathon');
    root.setWhy('Pour moi');
    root.setDueDate(new Date('2027-04-01T00:00:00.000Z'));
    const stage = new Objective('s1', 'Préparer le corps');
    root.addSubObjective(stage);
    const task = new Task('t1', 'Courir 5 km', 4, 2);
    task.setDescription('Le dimanche');
    task.setDone(true);
    stage.addTask(task);

    const flat = ObjectiveMapper.flatten(root, 'alice');

    expect(flat.objectives).toEqual([
      objectiveRow({
        id: 'o1',
        title: 'Courir un marathon',
        why: 'Pour moi',
        due_date: '2027-04-01T00:00:00.000Z',
      }),
      objectiveRow({ id: 's1', title: 'Préparer le corps', parent_id: 'o1' }),
    ]);
    expect(flat.tasks).toEqual([
      taskRow({
        id: 't1',
        objective_id: 's1',
        title: 'Courir 5 km',
        description: 'Le dimanche',
        done: true,
        importance: 4,
      }),
    ]);

    const rebuilt = ObjectiveMapper.toDomain(flat.objectives, flat.tasks, 'o1');
    expect(rebuilt?.subObjectives[0].tasks[0]).toMatchObject({
      id: 't1',
      done: true,
      description: 'Le dimanche',
      objectiveId: 's1',
    });
    expect(rebuilt?.subObjectives[0].parentId).toBe('o1');
  });

  it('reconstruit une étape demandée comme racine, en gardant son parent', () => {
    const rebuilt = ObjectiveMapper.toDomain(
      [objectiveRow({ id: 's1', parent_id: 'o1' }), objectiveRow({ id: 's2', parent_id: 's1' })],
      [taskRow({ id: 't1', objective_id: 's2' })],
      's1',
    );

    expect(rebuilt?.parentId).toBe('o1');
    expect(rebuilt?.subObjectives.map((objective) => objective.id)).toEqual(['s2']);
    expect(rebuilt?.subObjectives[0].tasks.map((task) => task.id)).toEqual(['t1']);
  });

  it('rend les lignes pour la query de chargement', () => {
    expect(
      ObjectiveMapper.toObjectiveOutput([objectiveRow({ id: 'o1', due_date: '2027-04-01T00:00:00.000Z' })]),
    ).toEqual([
      {
        id: 'o1',
        title: 'Objectif o1',
        description: '',
        why: '',
        dueDate: new Date('2027-04-01T00:00:00.000Z'),
        parentObjective: null,
      },
    ]);
    expect(ObjectiveMapper.toTaskOutput([taskRow({ id: 't1', objective_id: 'o1', done: true })])).toEqual([
      { id: 't1', title: 'Pas t1', importance: 3, urgency: 2, done: true, objectiveId: 'o1' },
    ]);
  });
});
