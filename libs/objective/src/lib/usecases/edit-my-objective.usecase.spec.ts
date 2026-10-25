import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { EditObjectiveUsecase } from './edit-my-objective.usecase';

describe('EditObjectiveUsecase', () => {
  const dueDate = new Date('2027-04-01T00:00:00.000Z');

  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, {
      id: 'o1',
      ownerId: 'alice',
      title: 'Courir',
      description: 'Avant',
      why: 'Parce que',
      dueDate,
    });
    seedObjective(infra.db, { id: 's1', ownerId: 'alice', parentId: 'o1' });
    seedTask(infra.db, { id: 't1', ownerId: 'alice', objectiveId: 's1', done: true });
    return { ...infra, usecase: new EditObjectiveUsecase(infra.objectiveRepository) };
  };

  it("modifie le titre et laisse inchangé ce qui n'est pas fourni", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      objective: { id: 'o1', title: 'Courir un marathon' },
      ownerId: 'alice',
    });

    expect(result).toEqual({
      success: true,
      data: { id: 'o1', title: 'Courir un marathon', description: 'Avant', why: 'Parce que', dueDate },
    });
    expect(db.objectives.get('o1')).toMatchObject({ title: 'Courir un marathon', description: 'Avant' });
    // Le sous-arbre enregistré avec l'objectif garde ses pas tels qu'ils étaient.
    expect(db.tasks.get('t1')?.done).toBe(true);
    expect(db.objectives.get('s1')?.parentId).toBe('o1');
  });

  it('remplace la description, le pourquoi et l’échéance', async () => {
    const { db, usecase } = setup();
    const newDueDate = new Date('2027-10-01T00:00:00.000Z');

    await usecase.execute({
      objective: { id: 'o1', title: 'Courir', description: 'Après', why: 'Pour moi', dueDate: newDueDate },
      ownerId: 'alice',
    });

    expect(db.objectives.get('o1')).toMatchObject({
      description: 'Après',
      why: 'Pour moi',
      dueDate: newDueDate,
    });
  });

  it("retire l'échéance avec dueDate: null", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({
      objective: { id: 'o1', title: 'Courir', dueDate: null },
      ownerId: 'alice',
    });

    expect(result).toMatchObject({ success: true, data: { dueDate: undefined } });
    expect(db.objectives.get('o1')?.dueDate).toBeNull();
  });

  it("ne trouve pas l'objectif d'une autre personne et n'y touche pas", async () => {
    const { db, usecase } = setup();

    const result = await usecase.execute({ objective: { id: 'o1', title: 'Volé' }, ownerId: 'mallory' });

    expect(result).toMatchObject({ success: false, error: { code: 'OBJECTIVE_NOT_FOUND' } });
    expect(db.objectives.get('o1')).toMatchObject({ title: 'Courir', ownerId: 'alice' });
  });

  it("signale FAIL_TO_SAVE_OBJECTIVE quand l'enregistrement n'aboutit pas", async () => {
    const { db, usecase } = setup();
    db.failWrites = true;

    const result = await usecase.execute({ objective: { id: 'o1', title: 'Courir' }, ownerId: 'alice' });

    expect(result).toMatchObject({ success: false, error: { code: 'FAIL_TO_SAVE_OBJECTIVE' } });
  });
});
