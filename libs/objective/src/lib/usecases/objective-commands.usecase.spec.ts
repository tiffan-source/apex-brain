import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { ClarifyObjectiveUsecase } from './clarify-objective.usecase';
import { RemoveObjectiveDeadlineUsecase } from './remove-objective-deadline.usecase';
import { RenameObjectiveUsecase } from './rename-objective.usecase';
import { SetObjectiveDeadlineUsecase } from './set-objective-deadline.usecase';

describe('Commandes sur un objectif ou une étape', () => {
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
    seedObjective(infra.db, { id: 's1', ownerId: 'alice', parentId: 'o1', title: 'Étape' });
    seedTask(infra.db, { id: 't1', ownerId: 'alice', objectiveId: 's1', done: true });
    const repository = infra.objectiveRepository;
    return {
      ...infra,
      rename: new RenameObjectiveUsecase(repository),
      clarify: new ClarifyObjectiveUsecase(repository),
      setDeadline: new SetObjectiveDeadlineUsecase(repository),
      removeDeadline: new RemoveObjectiveDeadlineUsecase(repository),
    };
  };

  describe('RenameObjectiveUsecase', () => {
    it("renomme l'objectif, rend l'entité entière et ne touche à rien d'autre", async () => {
      const { db, rename } = setup();

      const result = await rename.execute({
        objectiveId: 'o1',
        title: 'Courir un marathon',
        ownerId: 'alice',
      });

      expect(result).toEqual({
        success: true,
        data: {
          id: 'o1',
          title: 'Courir un marathon',
          description: 'Avant',
          why: 'Parce que',
          dueDate,
          parentObjectiveId: null,
          done: false,
        },
      });
      expect(db.objectives.get('o1')).toMatchObject({ title: 'Courir un marathon', description: 'Avant' });
      expect(db.tasks.get('t1')?.done).toBe(true);
    });

    it('renomme une étape, qui garde son parent', async () => {
      const { rename } = setup();

      const result = await rename.execute({ objectiveId: 's1', title: 'Préparer', ownerId: 'alice' });

      expect(result).toMatchObject({ success: true, data: { id: 's1', parentObjectiveId: 'o1' } });
    });

    it("ne trouve pas l'objectif d'une autre personne", async () => {
      const { db, rename } = setup();

      const result = await rename.execute({ objectiveId: 'o1', title: 'Volé', ownerId: 'mallory' });

      expect(result).toMatchObject({ success: false, error: { code: 'OBJECTIVE_NOT_FOUND' } });
      expect(db.objectives.get('o1')?.title).toBe('Courir');
    });

    it("signale FAIL_TO_SAVE_OBJECTIVE quand l'enregistrement n'aboutit pas", async () => {
      const { db, rename } = setup();
      db.failWrites = true;

      const result = await rename.execute({ objectiveId: 'o1', title: 'Courir', ownerId: 'alice' });

      expect(result).toMatchObject({ success: false, error: { code: 'FAIL_TO_SAVE_OBJECTIVE' } });
    });
  });

  describe('ClarifyObjectiveUsecase', () => {
    it('change ce qui est fourni et laisse le reste', async () => {
      const { db, clarify } = setup();

      const result = await clarify.execute({
        objectiveId: 'o1',
        why: 'Me prouver que je peux',
        ownerId: 'alice',
      });

      expect(result).toMatchObject({
        success: true,
        data: { description: 'Avant', why: 'Me prouver que je peux', title: 'Courir' },
      });
      expect(db.objectives.get('o1')).toMatchObject({ description: 'Avant', why: 'Me prouver que je peux' });
    });

    it('vide un champ avec une chaîne vide', async () => {
      const { db, clarify } = setup();

      const result = await clarify.execute({ objectiveId: 'o1', description: '', ownerId: 'alice' });

      expect(result).toMatchObject({ success: true, data: { description: '', why: 'Parce que' } });
      expect(db.objectives.get('o1')?.description).toBe('');
    });

    it("ne trouve pas l'objectif d'une autre personne", async () => {
      const { clarify } = setup();

      const result = await clarify.execute({ objectiveId: 'o1', why: 'Volé', ownerId: 'mallory' });

      expect(result).toMatchObject({ success: false, error: { code: 'OBJECTIVE_NOT_FOUND' } });
    });
  });

  describe('SetObjectiveDeadlineUsecase et RemoveObjectiveDeadlineUsecase', () => {
    it("fixe puis retire l'échéance", async () => {
      const { db, setDeadline, removeDeadline } = setup();
      const later = new Date('2027-09-01T00:00:00.000Z');

      const set = await setDeadline.execute({ objectiveId: 's1', dueDate: later, ownerId: 'alice' });
      expect(set).toMatchObject({ success: true, data: { id: 's1', dueDate: later } });
      expect(db.objectives.get('s1')?.dueDate).toEqual(later);

      const removed = await removeDeadline.execute({ objectiveId: 's1', ownerId: 'alice' });
      expect(removed).toMatchObject({ success: true, data: { id: 's1', dueDate: null } });
      expect(db.objectives.get('s1')?.dueDate).toBeNull();
    });

    it("réussit sans effet quand il n'y a pas d'échéance à retirer", async () => {
      const { removeDeadline } = setup();

      const result = await removeDeadline.execute({ objectiveId: 's1', ownerId: 'alice' });

      expect(result).toMatchObject({ success: true, data: { dueDate: null } });
    });

    it("ne trouve pas l'objectif d'une autre personne", async () => {
      const { db, setDeadline, removeDeadline } = setup();

      expect(await setDeadline.execute({ objectiveId: 'o1', dueDate, ownerId: 'mallory' })).toMatchObject({
        success: false,
        error: { code: 'OBJECTIVE_NOT_FOUND' },
      });
      expect(await removeDeadline.execute({ objectiveId: 'o1', ownerId: 'mallory' })).toMatchObject({
        success: false,
        error: { code: 'OBJECTIVE_NOT_FOUND' },
      });
      expect(db.objectives.get('o1')?.dueDate).toEqual(dueDate);
    });
  });
});
