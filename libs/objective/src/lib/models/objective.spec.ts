import { Objective } from './objective';
import { Task } from './task';

describe('Objective', () => {
  it("rattache un pas à l'objectif qui le reçoit", () => {
    const objective = new Objective('o1', 'Courir un marathon');
    const task = new Task('t1', 'Acheter des chaussures', 3, 2);

    objective.addTask(task);

    expect(task.objectiveId).toBe('o1');
    expect(objective.getTaskById('t1')).toBe(task);
  });

  it("rattache une étape à son parent, qui n'est plus un objectif principal", () => {
    const objective = new Objective('o1', 'Courir un marathon');
    const stage = new Objective('s1', 'Préparer le corps');

    objective.addSubObjective(stage);

    expect(stage.parentId).toBe('o1');
    expect(stage.isMainObjective).toBe(false);
    expect(objective.isMainObjective).toBe(true);
  });

  it("retire l'échéance", () => {
    const objective = new Objective('o1', 'Courir un marathon');
    objective.setDueDate(new Date('2027-04-01'));

    objective.clearDueDate();

    expect(objective.dueDate).toBeUndefined();
  });
});
