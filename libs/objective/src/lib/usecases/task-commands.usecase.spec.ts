import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { CompleteTaskUsecase } from './complete-task.usecase';
import { MoveTaskUsecase } from './move-task.usecase';
import { RenameTaskUsecase } from './rename-task.usecase';
import { ReopenTaskUsecase } from './reopen-task.usecase';
import { ReprioritizeTaskUsecase } from './reprioritize-task.usecase';

describe('Commandes sur un pas', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice' });
    seedObjective(infra.db, { id: 's1', ownerId: 'alice', parentId: 'o1' });
    seedObjective(infra.db, { id: 'o2', ownerId: 'alice' });
    seedObjective(infra.db, { id: 'm1', ownerId: 'mallory' });
    seedTask(infra.db, {
      id: 't1',
      ownerId: 'alice',
      objectiveId: 's1',
      title: 'Courir',
      importance: 3,
      urgency: 2,
    });
    seedTask(infra.db, { id: 't2', ownerId: 'alice', objectiveId: 's1', done: true });
    const { taskRepository, objectiveRepository } = infra;
    return {
      ...infra,
      rename: new RenameTaskUsecase(taskRepository),
      reprioritize: new ReprioritizeTaskUsecase(taskRepository),
      complete: new CompleteTaskUsecase(taskRepository),
      reopen: new ReopenTaskUsecase(taskRepository),
      move: new MoveTaskUsecase(objectiveRepository),
    };
  };

  it('renomme un pas et rend le pas entier', async () => {
    const { db, rename } = setup();

    const result = await rename.execute({ taskId: 't1', title: 'Courir 5 km', ownerId: 'alice' });

    expect(result).toEqual({
      success: true,
      data: { id: 't1', title: 'Courir 5 km', importance: 3, urgency: 2, done: false, objectiveId: 's1' },
    });
    expect(db.tasks.get('t1')?.title).toBe('Courir 5 km');
  });

  it("revoit l'importance et l'urgence d'un pas", async () => {
    const { db, reprioritize } = setup();

    const result = await reprioritize.execute({ taskId: 't1', importance: 5, urgency: 1, ownerId: 'alice' });

    expect(result).toMatchObject({ success: true, data: { importance: 5, urgency: 1, title: 'Courir' } });
    expect(db.tasks.get('t1')).toMatchObject({ importance: 5, urgency: 1 });
  });

  it('fait un pas, puis le remet à faire ; sans effet, la commande réussit quand même', async () => {
    const { db, complete, reopen } = setup();

    expect(await complete.execute({ taskId: 't1', ownerId: 'alice' })).toMatchObject({
      success: true,
      data: { id: 't1', done: true },
    });
    expect(db.tasks.get('t1')?.done).toBe(true);
    expect(await complete.execute({ taskId: 't1', ownerId: 'alice' })).toMatchObject({
      success: true,
      data: { done: true },
    });

    expect(await reopen.execute({ taskId: 't1', ownerId: 'alice' })).toMatchObject({
      success: true,
      data: { done: false },
    });
    expect(db.tasks.get('t1')?.done).toBe(false);
    expect(await reopen.execute({ taskId: 't1', ownerId: 'alice' })).toMatchObject({
      success: true,
      data: { done: false },
    });
  });

  it("ne trouve pas le pas d'une autre personne", async () => {
    const { db, rename, reprioritize, complete, reopen } = setup();

    for (const result of [
      await rename.execute({ taskId: 't1', title: 'Volé', ownerId: 'mallory' }),
      await reprioritize.execute({ taskId: 't1', importance: 1, urgency: 1, ownerId: 'mallory' }),
      await complete.execute({ taskId: 't1', ownerId: 'mallory' }),
      await reopen.execute({ taskId: 't2', ownerId: 'mallory' }),
    ]) {
      expect(result).toMatchObject({ success: false, error: { code: 'TASK_NOT_FOUND' } });
    }
    expect(db.tasks.get('t1')).toMatchObject({ title: 'Courir', done: false });
    expect(db.tasks.get('t2')?.done).toBe(true);
  });

  it("signale FAIL_TO_SAVE_TASK quand l'enregistrement n'aboutit pas", async () => {
    const { db, complete } = setup();
    db.failWrites = true;

    const result = await complete.execute({ taskId: 't1', ownerId: 'alice' });

    expect(result).toMatchObject({ success: false, error: { code: 'FAIL_TO_SAVE_TASK' } });
  });

  describe('MoveTaskUsecase', () => {
    it('déplace le pas vers un autre objectif sans toucher à ses voisins', async () => {
      const { db, move } = setup();

      const result = await move.execute({ taskId: 't2', objectiveId: 'o2', ownerId: 'alice' });

      expect(result).toEqual({
        success: true,
        data: { id: 't2', title: 'Pas t2', importance: 3, urgency: 2, done: true, objectiveId: 'o2' },
      });
      expect(db.tasks.get('t2')).toMatchObject({ objectiveId: 'o2', done: true });
      expect(db.tasks.get('t1')).toMatchObject({ objectiveId: 's1', title: 'Courir' });
    });

    it("remonte le pas vers un ancêtre sans l'enregistrer deux fois", async () => {
      const { db, move } = setup();

      const result = await move.execute({ taskId: 't1', objectiveId: 'o1', ownerId: 'alice' });

      expect(result).toMatchObject({ success: true, data: { objectiveId: 'o1' } });
      expect(db.tasks.get('t1')?.objectiveId).toBe('o1');
    });

    it("réussit sans effet vers l'objectif qui le porte déjà", async () => {
      const { db, move } = setup();
      db.failWrites = true;

      const result = await move.execute({ taskId: 't1', objectiveId: 's1', ownerId: 'alice' });

      expect(result).toMatchObject({ success: true, data: { objectiveId: 's1' } });
    });

    it("ne déplace ni le pas d'une autre personne, ni vers son objectif", async () => {
      const { db, move } = setup();

      expect(await move.execute({ taskId: 't1', objectiveId: 'o2', ownerId: 'mallory' })).toMatchObject({
        success: false,
        error: { code: 'TASK_NOT_FOUND' },
      });
      expect(await move.execute({ taskId: 't1', objectiveId: 'm1', ownerId: 'alice' })).toMatchObject({
        success: false,
        error: { code: 'OBJECTIVE_NOT_FOUND' },
      });
      expect(db.tasks.get('t1')?.objectiveId).toBe('s1');
    });

    it("descend un pas d'un objectif vers l'une de ses étapes", async () => {
      const { db, move } = setup();
      seedTask(db, { id: 't3', ownerId: 'alice', objectiveId: 'o1' });

      const result = await move.execute({ taskId: 't3', objectiveId: 's1', ownerId: 'alice' });

      expect(result).toMatchObject({ success: true, data: { objectiveId: 's1' } });
      expect(db.tasks.get('t3')?.objectiveId).toBe('s1');
      expect(db.tasks.get('t2')).toMatchObject({ objectiveId: 's1', done: true });
    });

    it("signale FAIL_TO_SAVE_OBJECTIVE quand l'enregistrement n'aboutit pas", async () => {
      const { db, move } = setup();
      db.failWrites = true;

      const result = await move.execute({ taskId: 't1', objectiveId: 'o2', ownerId: 'alice' });

      expect(result).toMatchObject({ success: false, error: { code: 'FAIL_TO_SAVE_OBJECTIVE' } });
      expect(db.tasks.get('t1')?.objectiveId).toBe('s1');
    });
  });
});
