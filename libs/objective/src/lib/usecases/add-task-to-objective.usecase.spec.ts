import { SequentialIdGenerator } from '@org/chore/testing';
import { createInMemoryObjectiveInfrastructure, seedObjective } from '../../testing';
import { AddTaskToObjectiveUsecase } from './add-task-to-objective.usecase';

describe('AddTaskToObjectiveUsecase', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice' });
    seedObjective(infra.db, { id: 's1', ownerId: 'alice', parentId: 'o1' });
    const usecase = new AddTaskToObjectiveUsecase(
      infra.objectiveRepository,
      new SequentialIdGenerator('task'),
    );
    return { ...infra, usecase };
  };

  it('ajoute un pas à une étape', async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      objectiveId: 's1',
      title: 'Courir 5 km',
      importance: 4,
      urgency: 2,
      ownerId: 'alice',
    });

    expect(result).toEqual({
      success: true,
      data: { id: 'task-1', title: 'Courir 5 km', importance: 4, urgency: 2 },
    });
    expect(db.tasks.get('task-1')).toMatchObject({ objectiveId: 's1', ownerId: 'alice', done: false });
  });

  it("ne trouve pas l'objectif d'une autre personne", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      objectiveId: 's1',
      title: 'Intrusion',
      importance: 1,
      urgency: 1,
      ownerId: 'mallory',
    });

    expect(result).toMatchObject({ success: false, error: { code: 'OBJECTIVE_NOT_FOUND' } });
    expect(db.tasks.size).toBe(0);
  });

  it("signale FAIL_TO_SAVE_OBJECTIVE quand l'enregistrement n'aboutit pas", async () => {
    const { db, usecase } = setup();
    db.failWrites = true;

    const result = await usecase.execute({
      objectiveId: 'o1',
      title: 'Courir 5 km',
      importance: 4,
      urgency: 2,
      ownerId: 'alice',
    });

    expect(result).toMatchObject({ success: false, error: { code: 'FAIL_TO_SAVE_OBJECTIVE' } });
  });
});
