import { SequentialIdGenerator } from '@org/chore/testing';
import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { ObjectiveInternalService } from './objective-internal-service';

describe('ObjectiveInternalService', () => {
  const setup = () => {
    const infra = createInMemoryObjectiveInfrastructure();
    seedObjective(infra.db, { id: 'o1', ownerId: 'alice', title: 'Courir', why: 'Pour moi' });
    seedObjective(infra.db, { id: 's1', ownerId: 'alice', parentId: 'o1', title: 'Préparer' });
    seedTask(infra.db, { id: 't1', ownerId: 'alice', objectiveId: 's1', title: 'Courir 5 km', done: true });
    const service = new ObjectiveInternalService(infra.objectiveRepository, new SequentialIdGenerator('new'));
    return { ...infra, service };
  };

  it("rend l'arbre complet de l'objectif", async () => {
    const { service } = setup();

    await expect(service.getObjectiveTree('o1', 'alice')).resolves.toEqual({
      id: 'o1',
      title: 'Courir',
      description: undefined,
      why: 'Pour moi',
      dueDate: undefined,
      tasks: [],
      subObjectives: [
        {
          id: 's1',
          title: 'Préparer',
          description: undefined,
          why: undefined,
          dueDate: undefined,
          tasks: [{ id: 't1', title: 'Courir 5 km', importance: 3, urgency: 2, done: true }],
          subObjectives: [],
        },
      ],
    });
  });

  it("ne rend rien de l'objectif d'une autre personne", async () => {
    const { service } = setup();

    await expect(service.getObjectiveTree('o1', 'mallory')).resolves.toBeNull();
  });

  it('crée une étape et un pas pour la personne', async () => {
    const { db, service } = setup();

    await expect(service.createSubObjective('o1', 'Nouvelle étape', 'alice')).resolves.toEqual({
      id: 'new-1',
      title: 'Nouvelle étape',
    });
    await expect(
      service.addTask('new-1', { title: 'Nouveau pas', importance: 4, urgency: 1 }, 'alice'),
    ).resolves.toEqual({
      id: 'new-2',
      title: 'Nouveau pas',
      importance: 4,
      urgency: 1,
    });
    expect(db.objectives.get('new-1')).toMatchObject({ parentId: 'o1', ownerId: 'alice' });
    expect(db.tasks.get('new-2')).toMatchObject({ objectiveId: 'new-1', ownerId: 'alice' });
    expect(db.tasks.get('t1')?.done).toBe(true);
  });

  it("refuse d'écrire sous l'objectif d'une autre personne", async () => {
    const { db, service } = setup();

    await expect(service.createSubObjective('o1', 'Intrusion', 'mallory')).resolves.toBeNull();
    await expect(
      service.addTask('s1', { title: 'Intrusion', importance: 1, urgency: 1 }, 'mallory'),
    ).resolves.toBeNull();
    expect(db.objectives.size).toBe(2);
    expect(db.tasks.size).toBe(1);
  });

  it("rend null quand l'enregistrement n'aboutit pas", async () => {
    const { db, service } = setup();
    db.failWrites = true;

    await expect(service.createSubObjective('o1', 'Nouvelle étape', 'alice')).resolves.toBeNull();
    await expect(
      service.addTask('o1', { title: 'Nouveau pas', importance: 4, urgency: 1 }, 'alice'),
    ).resolves.toBeNull();
  });
});
