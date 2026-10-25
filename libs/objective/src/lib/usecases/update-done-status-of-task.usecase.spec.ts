import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { UpdateDoneStatusOfTaskUsecase } from './update-done-status-of-task.usecase';

describe('UpdateDoneStatusOfTaskUsecase', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice' });
    seedTask(infra.db, { id: 't1', ownerId: 'alice', objectiveId: 'o1', title: 'Courir 5 km' });
    return { ...infra, usecase: new UpdateDoneStatusOfTaskUsecase(infra.taskRepository) };
  };

  it('coche puis décoche un pas', async () => {
    const { db, usecase } = setup();

    const checked = await usecase.execute({ taskId: 't1', done: true, ownerId: 'alice' });
    expect(checked).toEqual({ success: true, data: { id: 't1', title: 'Courir 5 km', done: true } });
    expect(db.tasks.get('t1')?.done).toBe(true);

    await usecase.execute({ taskId: 't1', done: false, ownerId: 'alice' });
    expect(db.tasks.get('t1')?.done).toBe(false);
  });

  it("signale TASK_NOT_FOUND pour le pas d'une autre personne", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({ taskId: 't1', done: true, ownerId: 'mallory' });

    expect(result).toMatchObject({ success: false, error: { code: 'TASK_NOT_FOUND' } });
    expect(db.tasks.get('t1')?.done).toBe(false);
  });

  it("signale FAIL_TO_SAVE_TASK quand l'enregistrement n'aboutit pas", async () => {
    const { db, usecase } = setup();
    db.failWrites = true;

    const result = await usecase.execute({ taskId: 't1', done: true, ownerId: 'alice' });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'FAIL_TO_SAVE_TASK', metadata: { taskId: 't1' } },
    });
  });
});
