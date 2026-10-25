import { SequentialIdGenerator } from '@org/chore/testing';
import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { AddSubObjectiveUsecase } from './add-sub-objective.usecase';

describe('AddSubObjectiveUsecase', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice' });
    seedTask(infra.db, { id: 't1', ownerId: 'alice', objectiveId: 'o1', done: true });
    const usecase = new AddSubObjectiveUsecase(infra.objectiveRepository, new SequentialIdGenerator('stage'));
    return { ...infra, usecase };
  };

  it("ajoute une étape sous l'objectif, sans toucher au reste de l'arbre", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      parentObjectiveId: 'o1',
      title: 'Préparer le corps',
      ownerId: 'alice',
    });

    expect(result).toEqual({ success: true, data: { id: 'stage-1', title: 'Préparer le corps' } });
    expect(db.objectives.get('stage-1')).toMatchObject({ parentId: 'o1', ownerId: 'alice' });
    expect(db.tasks.get('t1')?.done).toBe(true);
  });

  it('ajoute une étape sous une étape', async () => {
    const { db, usecase } = setup();
    seedObjective(db, { id: 's1', ownerId: 'alice', parentId: 'o1' });

    const result = await usecase.execute({ parentObjectiveId: 's1', title: 'Sous-étape', ownerId: 'alice' });

    expect(result.success).toBe(true);
    expect(db.objectives.get('stage-1')?.parentId).toBe('s1');
    expect(db.objectives.get('s1')?.parentId).toBe('o1');
  });

  it("ne trouve pas l'objectif d'une autre personne", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({ parentObjectiveId: 'o1', title: 'Intrusion', ownerId: 'mallory' });

    expect(result).toMatchObject({ success: false, error: { code: 'OBJECTIVE_NOT_FOUND' } });
    expect(db.objectives.size).toBe(1);
  });

  it("signale FAIL_TO_SAVE_OBJECTIVE quand l'enregistrement n'aboutit pas", async () => {
    const { db, usecase } = setup();
    db.failWrites = true;

    const result = await usecase.execute({
      parentObjectiveId: 'o1',
      title: 'Préparer le corps',
      ownerId: 'alice',
    });

    expect(result).toMatchObject({ success: false, error: { code: 'FAIL_TO_SAVE_OBJECTIVE' } });
  });
});
