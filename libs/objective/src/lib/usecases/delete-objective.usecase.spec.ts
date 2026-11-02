import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { DeleteObjectiveUsecase } from './delete-objective.usecase';

describe('DeleteObjectiveUsecase', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice' });
    seedObjective(infra.db, { id: 's1', ownerId: 'alice', parentId: 'o1' });
    seedObjective(infra.db, { id: 's2', ownerId: 'alice', parentId: 's1' });
    seedObjective(infra.db, { id: 's3', ownerId: 'alice', parentId: 'o1' });
    seedObjective(infra.db, { id: 'o2', ownerId: 'alice' });
    seedTask(infra.db, { id: 't0', ownerId: 'alice', objectiveId: 'o1' });
    seedTask(infra.db, { id: 't1', ownerId: 'alice', objectiveId: 's1' });
    seedTask(infra.db, { id: 't2', ownerId: 'alice', objectiveId: 's2' });
    seedTask(infra.db, { id: 't3', ownerId: 'alice', objectiveId: 's3' });
    seedTask(infra.db, { id: 't4', ownerId: 'alice', objectiveId: 'o2' });
    return { ...infra, usecase: new DeleteObjectiveUsecase(infra.objectiveRepository) };
  };

  const idsOf = (rows: Map<string, unknown>) => [...rows.keys()];

  it('supprime un objectif, toutes ses étapes et tous leurs pas, sans toucher au reste', async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({ objectiveId: 'o1', ownerId: 'alice' });

    expect(result).toEqual({ success: true, data: undefined });
    expect(idsOf(db.objectives)).toEqual(['o2']);
    expect(idsOf(db.tasks)).toEqual(['t4']);
  });

  it('supprime une étape et ce qui en dépend, sans toucher à son parent ni à ses voisines', async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({ objectiveId: 's1', ownerId: 'alice' });

    expect(result.success).toBe(true);
    expect(idsOf(db.objectives)).toEqual(['o1', 's3', 'o2']);
    expect(idsOf(db.tasks)).toEqual(['t0', 't3', 't4']);
  });

  it('signale OBJECTIVE_NOT_FOUND pour un objectif inconnu ou déjà supprimé', async () => {
    const { usecase } = setup();

    await expect(usecase.execute({ objectiveId: 'inconnu', ownerId: 'alice' })).resolves.toMatchObject({
      success: false,
      error: { code: 'OBJECTIVE_NOT_FOUND', metadata: { objectiveId: 'inconnu' } },
    });

    await usecase.execute({ objectiveId: 'o1', ownerId: 'alice' });

    await expect(usecase.execute({ objectiveId: 'o1', ownerId: 'alice' })).resolves.toMatchObject({
      success: false,
      error: { code: 'OBJECTIVE_NOT_FOUND' },
    });
  });

  it("signale OBJECTIVE_NOT_FOUND pour l'objectif d'une autre personne, sans rien supprimer", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({ objectiveId: 'o1', ownerId: 'mallory' });

    expect(result).toMatchObject({ success: false, error: { code: 'OBJECTIVE_NOT_FOUND' } });
    expect(idsOf(db.objectives)).toEqual(['o1', 's1', 's2', 's3', 'o2']);
    expect(db.tasks.size).toBe(5);
  });

  it('signale UNKNOWN_ERROR quand la base est en panne, sans rien supprimer', async () => {
    const { db, usecase } = setup();
    db.failWrites = true;

    const result = await usecase.execute({ objectiveId: 'o1', ownerId: 'alice' });

    expect(result).toMatchObject({ success: false, error: { code: 'UNKNOWN_ERROR' } });
    expect(db.objectives.size).toBe(5);
  });
});
