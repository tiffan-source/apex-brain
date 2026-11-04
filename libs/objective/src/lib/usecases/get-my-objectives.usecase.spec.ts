import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { GetMyObjectivesUsecase } from './get-my-objectives.usecase';

describe('GetMyObjectivesUsecase', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice' });
    seedObjective(infra.db, { id: 's1', ownerId: 'alice', parentId: 'o1' });
    seedObjective(infra.db, { id: 's2', ownerId: 'alice', parentId: 'o1' });
    return { ...infra, usecase: new GetMyObjectivesUsecase(infra.getAllObjectiveAndTaskQuery) };
  };

  const doneById = async (usecase: GetMyObjectivesUsecase) => {
    const result = await usecase.execute({ ownerId: 'alice' });
    if (!result.success) throw new Error(result.error.message);
    return Object.fromEntries(result.data.objectives.map((row) => [row.id, row.done]));
  };

  it('rend une étape sans pas non faite', async () => {
    const { usecase } = setup();

    await expect(doneById(usecase)).resolves.toEqual({ o1: false, s1: false, s2: false });
  });

  it('rend une étape faite dès que tous ses pas le sont, sans regarder les autres étapes', async () => {
    const { db, usecase } = setup();
    seedTask(db, { id: 't1', ownerId: 'alice', objectiveId: 's1' });
    seedTask(db, { id: 't2', ownerId: 'alice', objectiveId: 's2', done: true });

    await expect(doneById(usecase)).resolves.toEqual({ o1: false, s1: false, s2: true });
  });

  it('garde une étape non faite tant que tous ses pas ne sont pas faits', async () => {
    const { db, usecase } = setup();
    seedTask(db, { id: 't1', ownerId: 'alice', objectiveId: 's1', done: true });
    seedTask(db, { id: 't2', ownerId: 'alice', objectiveId: 's1' });

    await expect(doneById(usecase)).resolves.toMatchObject({ s1: false });
  });

  it('compte les pas des sous-objectifs plus profonds dans leur étape et dans leur objectif', async () => {
    const { db, usecase } = setup();
    seedObjective(db, { id: 's3', ownerId: 'alice', parentId: 's1' });
    seedTask(db, { id: 't1', ownerId: 'alice', objectiveId: 's3', done: true });
    seedTask(db, { id: 't2', ownerId: 'alice', objectiveId: 's2', done: true });

    await expect(doneById(usecase)).resolves.toEqual({ o1: true, s1: true, s2: true, s3: true });
  });

  it("ne fait pas un objectif dont un pas sans étape n'est pas fait", async () => {
    const { db, usecase } = setup();
    seedTask(db, { id: 't1', ownerId: 'alice', objectiveId: 's1', done: true });
    seedTask(db, { id: 't2', ownerId: 'alice', objectiveId: 'o1' });

    await expect(doneById(usecase)).resolves.toEqual({ o1: false, s1: true, s2: false });
  });

  it('rend les pas tels quels, et seulement ceux de la personne', async () => {
    const { db, usecase } = setup();
    seedTask(db, { id: 't1', ownerId: 'alice', objectiveId: 's1', done: true });
    seedObjective(db, { id: 'x1', ownerId: 'mallory' });
    seedTask(db, { id: 'x2', ownerId: 'mallory', objectiveId: 'x1', done: true });

    const result = await usecase.execute({ ownerId: 'alice' });

    expect(result).toMatchObject({ success: true, data: { tasks: [{ id: 't1', done: true }] } });
    if (result.success) expect(result.data.objectives.map((row) => row.id)).toEqual(['o1', 's1', 's2']);
  });

  it('signale UNKNOWN_ERROR quand la lecture échoue', async () => {
    const { usecase, getAllObjectiveAndTaskQuery } = setup();
    vi.spyOn(getAllObjectiveAndTaskQuery, 'execute').mockRejectedValueOnce(new Error('base injoignable'));

    await expect(usecase.execute({ ownerId: 'alice' })).resolves.toMatchObject({
      success: false,
      error: { code: 'UNKNOWN_ERROR' },
    });
  });
});
