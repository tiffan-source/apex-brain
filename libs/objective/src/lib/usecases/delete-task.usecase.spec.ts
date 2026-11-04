import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { DeleteTaskUsecase } from './delete-task.usecase';

describe('DeleteTaskUsecase', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice' });
    seedTask(infra.db, { id: 't1', ownerId: 'alice', objectiveId: 'o1' });
    seedTask(infra.db, { id: 't2', ownerId: 'alice', objectiveId: 'o1' });
    return { ...infra, usecase: new DeleteTaskUsecase(infra.taskRepository) };
  };

  it('supprime le pas sans toucher à ses voisins ni à son objectif', async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({ taskId: 't1', ownerId: 'alice' });

    expect(result).toEqual({ success: true, data: undefined });
    expect([...db.tasks.keys()]).toEqual(['t2']);
    expect(db.objectives.has('o1')).toBe(true);
  });

  it('signale TASK_NOT_FOUND pour un pas inconnu ou déjà supprimé', async () => {
    const { usecase } = setup();

    await expect(usecase.execute({ taskId: 'inconnu', ownerId: 'alice' })).resolves.toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND', metadata: { taskId: 'inconnu' } },
    });

    await usecase.execute({ taskId: 't1', ownerId: 'alice' });

    await expect(usecase.execute({ taskId: 't1', ownerId: 'alice' })).resolves.toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND' },
    });
  });

  it("signale TASK_NOT_FOUND pour le pas d'une autre personne, sans le supprimer", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({ taskId: 't1', ownerId: 'mallory' });

    expect(result).toMatchObject({ success: false, error: { code: 'TASK_NOT_FOUND' } });
    expect(db.tasks.has('t1')).toBe(true);
  });

  it('signale UNKNOWN_ERROR quand la base est en panne', async () => {
    const { db, usecase } = setup();
    db.failWrites = true;

    const result = await usecase.execute({ taskId: 't1', ownerId: 'alice' });

    expect(result).toMatchObject({ success: false, error: { code: 'UNKNOWN_ERROR' } });
    expect(db.tasks.has('t1')).toBe(true);
  });
});
