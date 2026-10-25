import { SequentialIdGenerator } from '@org/chore/testing';
import { createInMemoryObjectiveInfrastructure } from '../../testing';
import { CreateObjectiveUsecase } from './create-objective.usecase';

describe('CreateObjectiveUsecase', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    const usecase = new CreateObjectiveUsecase(infra.objectiveRepository, new SequentialIdGenerator('obj'));
    return { ...infra, usecase };
  };

  it('définit un objectif au nom de la personne', async () => {
    const { db, usecase } = setup();
    const dueDate = new Date('2027-04-01T00:00:00.000Z');

    const result = await usecase.execute({
      title: 'Courir un marathon',
      description: 'Le marathon de Paris',
      why: 'Me prouver que je peux',
      dueDate,
      ownerId: 'alice',
    });

    expect(result).toEqual({
      success: true,
      data: {
        id: 'obj-1',
        title: 'Courir un marathon',
        description: 'Le marathon de Paris',
        why: 'Me prouver que je peux',
        dueDate,
      },
    });
    expect(db.objectives.get('obj-1')).toMatchObject({ ownerId: 'alice', parentId: null, done: false });
  });

  it("signale FAIL_TO_SAVE_OBJECTIVE quand l'enregistrement n'aboutit pas", async () => {
    const { db, usecase } = setup();
    db.failWrites = true;

    const result = await usecase.execute({ title: 'Courir un marathon', ownerId: 'alice' });

    expect(result).toMatchObject({ success: false, error: { code: 'FAIL_TO_SAVE_OBJECTIVE' } });
  });
});
