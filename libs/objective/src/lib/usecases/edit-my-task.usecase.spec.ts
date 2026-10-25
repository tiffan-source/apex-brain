import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { EditMyTaskUsecase } from './edit-my-task.usecase';

describe('EditMyTaskUsecase', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice' });
    seedObjective(infra.db, { id: 's1', ownerId: 'alice', parentId: 'o1' });
    seedObjective(infra.db, { id: 's2', ownerId: 'alice', parentId: 'o1' });
    seedTask(infra.db, {
      id: 't1',
      ownerId: 'alice',
      objectiveId: 's1',
      title: 'Avant',
      importance: 2,
      urgency: 2,
    });
    seedTask(infra.db, { id: 't2', ownerId: 'alice', objectiveId: 's1', done: true });
    seedObjective(infra.db, { id: 'm1', ownerId: 'mallory' });
    return { ...infra, usecase: new EditMyTaskUsecase(infra.objectiveRepository) };
  };

  it('modifie un pas sans toucher à ses voisins', async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      task: { id: 't1', title: 'Après', objectiveId: 's1', importance: 4, urgency: 5 },
      ownerId: 'alice',
    });

    expect(result).toEqual({
      success: true,
      data: { id: 't1', title: 'Après', objectiveId: 's1', importance: 4, urgency: 5 },
    });
    expect(db.tasks.get('t1')).toMatchObject({
      title: 'Après',
      importance: 4,
      urgency: 5,
      objectiveId: 's1',
    });
    // Dans Apex, le voisin fait repassait à « non fait » (pas rechargés sans `done`).
    expect(db.tasks.get('t2')?.done).toBe(true);
  });

  it('déplace un pas vers une autre étape', async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      task: { id: 't1', title: 'Avant', objectiveId: 's2', importance: 2, urgency: 2 },
      ownerId: 'alice',
    });

    expect(result).toMatchObject({ success: true, data: { objectiveId: 's2' } });
    expect(db.tasks.get('t1')?.objectiveId).toBe('s2');
    expect(db.tasks.get('t2')).toMatchObject({ objectiveId: 's1', done: true });
  });

  it("remonte un pas d'une étape vers son objectif", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      task: { id: 't1', title: 'Avant', objectiveId: 'o1', importance: 2, urgency: 2 },
      ownerId: 'alice',
    });

    expect(result).toMatchObject({ success: true, data: { objectiveId: 'o1' } });
    expect(db.tasks.get('t1')?.objectiveId).toBe('o1');
    expect(db.tasks.get('t2')).toMatchObject({ objectiveId: 's1', done: true });
  });

  it("descend un pas d'un objectif vers l'une de ses étapes", async () => {
    const { db, usecase } = setup();
    seedTask(db, { id: 't3', ownerId: 'alice', objectiveId: 'o1' });

    const result = await usecase.execute({
      task: { id: 't3', title: 'Pas t3', objectiveId: 's2', importance: 3, urgency: 2 },
      ownerId: 'alice',
    });

    expect(result).toMatchObject({ success: true, data: { objectiveId: 's2' } });
    expect(db.tasks.get('t3')?.objectiveId).toBe('s2');
  });

  it('signale TASK_NOT_FOUND pour un pas inconnu', async () => {
    const { usecase } = setup();

    const result = await usecase.execute({
      task: { id: 'inconnu', title: 'X', objectiveId: 's1', importance: 1, urgency: 1 },
      ownerId: 'alice',
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND', metadata: { taskId: 'inconnu' } },
    });
  });

  it("signale TASK_NOT_FOUND pour le pas d'une autre personne", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      task: { id: 't1', title: 'Volé', objectiveId: 'm1', importance: 1, urgency: 1 },
      ownerId: 'mallory',
    });

    expect(result).toMatchObject({ success: false, error: { code: 'TASK_NOT_FOUND' } });
    expect(db.tasks.get('t1')).toMatchObject({ title: 'Avant', objectiveId: 's1', ownerId: 'alice' });
  });

  it("signale OBJECTIVE_NOT_FOUND quand l'étape d'arrivée appartient à une autre personne", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      task: { id: 't1', title: 'Avant', objectiveId: 'm1', importance: 2, urgency: 2 },
      ownerId: 'alice',
    });

    expect(result).toMatchObject({ success: false, error: { code: 'OBJECTIVE_NOT_FOUND' } });
    expect(db.tasks.get('t1')?.objectiveId).toBe('s1');
  });

  it("signale FAIL_TO_SAVE_OBJECTIVE quand l'enregistrement n'aboutit pas", async () => {
    const { db, usecase } = setup();
    db.failWrites = true;

    const result = await usecase.execute({
      task: { id: 't1', title: 'Après', objectiveId: 's1', importance: 2, urgency: 2 },
      ownerId: 'alice',
    });

    expect(result).toMatchObject({ success: false, error: { code: 'FAIL_TO_SAVE_OBJECTIVE' } });
  });
});
