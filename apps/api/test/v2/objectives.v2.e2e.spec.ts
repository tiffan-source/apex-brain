import { seedObjective, seedTask } from '@org/objective/testing';
import {
  objectiveCommandResponseSchema,
  taskCommandResponseSchema,
} from '../../src/objectives/v2/objectives.v2.schemas';
import type { TestApp } from '../support/test-app';
import { createTestApp } from '../support/test-app';

describe('v2 — commandes sur un objectif ou une étape (e2e)', () => {
  let t: TestApp;
  let alice: ReturnType<TestApp['signIn']>;
  let mallory: ReturnType<TestApp['signIn']>;

  beforeEach(async () => {
    t = await createTestApp();
    alice = t.signIn('alice@apex.test');
    mallory = t.signIn('mallory@apex.test');
  });

  afterEach(() => t.close());

  const as = (who: { authorization: string }) => ({
    post: (path: string, body?: object) =>
      t.http().post(path).set('Authorization', who.authorization).send(body),
    patch: (path: string, body?: object) =>
      t.http().patch(path).set('Authorization', who.authorization).send(body),
    delete: (path: string) => t.http().delete(path).set('Authorization', who.authorization),
  });

  it("définit un objectif et rend l'entité entière (createObjective)", async () => {
    const response = await as(alice).post('/v2/objectives', {
      title: '  Courir un marathon  ',
      why: 'Me prouver que je peux',
      dueDate: '2027-04-01',
    });

    expect(response.status).toBe(201);
    expect(objectiveCommandResponseSchema.parse(response.body)).toEqual({
      id: expect.any(String),
      title: 'Courir un marathon',
      description: '',
      why: 'Me prouver que je peux',
      dueDate: '2027-04-01T00:00:00.000Z',
      parentObjectiveId: null,
      done: false,
    });
  });

  it('ajoute une étape et un pas, chacun rendu entier avec qui le porte (addSubObjective, addTaskToObjective)', async () => {
    seedObjective(t.objectives.db, { id: 'o1', ownerId: alice.id });

    const stage = await as(alice).post('/v2/objectives/o1/sub-objectives', { title: 'Préparer le corps' });
    expect(stage.status).toBe(201);
    const stageBody = objectiveCommandResponseSchema.parse(stage.body);
    expect(stageBody).toMatchObject({ title: 'Préparer le corps', parentObjectiveId: 'o1', done: false });

    const task = await as(alice).post(`/v2/objectives/${stageBody.id}/tasks`, {
      title: 'Courir 5 km',
      importance: 4,
      urgency: 2,
    });
    expect(task.status).toBe(201);
    expect(taskCommandResponseSchema.parse(task.body)).toEqual({
      id: expect.any(String),
      title: 'Courir 5 km',
      importance: 4,
      urgency: 2,
      done: false,
      objectiveId: stageBody.id,
    });
  });

  describe('modifier un objectif', () => {
    beforeEach(() => {
      seedObjective(t.objectives.db, {
        id: 'o1',
        ownerId: alice.id,
        title: 'Courir',
        description: 'Avant',
        why: 'Parce que',
        dueDate: new Date('2027-04-01T00:00:00.000Z'),
      });
      seedObjective(t.objectives.db, { id: 's1', ownerId: alice.id, parentId: 'o1', title: 'Étape' });
      seedTask(t.objectives.db, { id: 't1', ownerId: alice.id, objectiveId: 's1', done: true });
    });

    it('renomme (renameObjective)', async () => {
      const response = await as(alice).patch('/v2/objectives/o1/rename', { title: 'Courir un marathon' });

      expect(response.status).toBe(200);
      expect(objectiveCommandResponseSchema.parse(response.body)).toEqual({
        id: 'o1',
        title: 'Courir un marathon',
        description: 'Avant',
        why: 'Parce que',
        dueDate: '2027-04-01T00:00:00.000Z',
        parentObjectiveId: null,
        done: false,
      });
      expect(t.objectives.db.tasks.get('t1')?.done).toBe(true);
    });

    it('précise une étape sans toucher au reste (clarifyObjective)', async () => {
      const response = await as(alice).patch('/v2/objectives/s1/clarify', { why: 'Pour tenir la distance' });

      expect(response.status).toBe(200);
      expect(objectiveCommandResponseSchema.parse(response.body)).toMatchObject({
        id: 's1',
        why: 'Pour tenir la distance',
        description: '',
        parentObjectiveId: 'o1',
      });
    });

    it('refuse de préciser sans description ni pourquoi (VALIDATION_ERROR)', async () => {
      const response = await as(alice).patch('/v2/objectives/o1/clarify', {});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it("fixe puis retire l'échéance, deux fois sans erreur (setObjectiveDeadline, removeObjectiveDeadline)", async () => {
      const set = await as(alice).patch('/v2/objectives/o1/set-deadline', { dueDate: '2027-09-01' });
      expect(set.status).toBe(200);
      expect(set.body.dueDate).toBe('2027-09-01T00:00:00.000Z');

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const removed = await as(alice).patch('/v2/objectives/o1/remove-deadline');
        expect(removed.status).toBe(200);
        expect(objectiveCommandResponseSchema.parse(removed.body).dueDate).toBeNull();
      }
    });

    it("refuse une échéance qui n'est pas une date (VALIDATION_ERROR)", async () => {
      const response = await as(alice).patch('/v2/objectives/o1/set-deadline', { dueDate: 'demain' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it("ne laisse personne d'autre modifier ni supprimer l'objectif (OBJECTIVE_NOT_FOUND)", async () => {
      const beforeObjectives = t.objectives.db.objectives.size;
      const beforeTasks = t.objectives.db.tasks.size;
      const attempts = [
        await as(mallory).patch('/v2/objectives/o1/rename', { title: 'Volé' }),
        await as(mallory).patch('/v2/objectives/o1/clarify', { why: 'Volé' }),
        await as(mallory).patch('/v2/objectives/o1/set-deadline', { dueDate: '2030-01-01' }),
        await as(mallory).patch('/v2/objectives/o1/remove-deadline'),
        await as(mallory).post('/v2/objectives/o1/sub-objectives', { title: 'Intrusion' }),
        await as(mallory).post('/v2/objectives/o1/tasks', { title: 'Intrusion', importance: 1, urgency: 1 }),
        await as(mallory).delete('/v2/objectives/o1'),
      ];

      for (const response of attempts) {
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('OBJECTIVE_NOT_FOUND');
      }
      expect(t.objectives.db.objectives.get('o1')).toMatchObject({
        title: 'Courir',
        why: 'Parce que',
        dueDate: new Date('2027-04-01T00:00:00.000Z'),
      });
      // Ni étape ni pas ajoutés sous l'objectif d'Alice.
      expect(t.objectives.db.objectives.size).toBe(beforeObjectives);
      expect(t.objectives.db.tasks.size).toBe(beforeTasks);
    });

    it('supprime un objectif avec ses étapes et ses pas (deleteObjective)', async () => {
      const response = await as(alice).delete('/v2/objectives/o1');

      expect(response.status).toBe(204);
      expect(t.objectives.db.objectives.size).toBe(0);
      expect(t.objectives.db.tasks.size).toBe(0);
      expect((await as(alice).delete('/v2/objectives/o1')).status).toBe(404);
    });
  });

  describe('suppression (deleteObjective)', () => {
    /** Alice : `o1` avec les étapes `s1` (qui porte `s2`) et `s3`, et un autre objectif `o2`. */
    const seedTree = () => {
      const { db } = t.objectives;
      seedObjective(db, { id: 'o1', ownerId: alice.id });
      seedObjective(db, { id: 's1', ownerId: alice.id, parentId: 'o1' });
      seedObjective(db, { id: 's2', ownerId: alice.id, parentId: 's1' });
      seedObjective(db, { id: 's3', ownerId: alice.id, parentId: 'o1' });
      seedObjective(db, { id: 'o2', ownerId: alice.id });
      seedTask(db, { id: 't1', ownerId: alice.id, objectiveId: 's1' });
      seedTask(db, { id: 't2', ownerId: alice.id, objectiveId: 's2' });
      seedTask(db, { id: 't3', ownerId: alice.id, objectiveId: 's3' });
      seedTask(db, { id: 't4', ownerId: alice.id, objectiveId: 'o2' });
    };

    const remaining = () => ({
      objectives: [...t.objectives.db.objectives.keys()],
      tasks: [...t.objectives.db.tasks.keys()],
    });

    it("supprime une étape avec ce qu'elle porte, sans toucher à son objectif ni à ses voisines", async () => {
      seedTree();

      const response = await as(alice).delete('/v2/objectives/s1');

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      expect(remaining()).toEqual({ objectives: ['o1', 's3', 'o2'], tasks: ['t3', 't4'] });
    });

    it('répond 404 pour un objectif inconnu ou déjà supprimé', async () => {
      seedTree();
      expect((await as(alice).delete('/v2/objectives/o1')).status).toBe(204);
      expect(remaining()).toEqual({ objectives: ['o2'], tasks: ['t4'] });

      for (const id of ['o1', 's1', 'inconnu']) {
        const response = await as(alice).delete(`/v2/objectives/${id}`);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('OBJECTIVE_NOT_FOUND');
      }
    });

    it('demande un jeton', async () => {
      seedTree();

      expect((await t.http().delete('/v2/objectives/o1')).status).toBe(401);
      expect(remaining().objectives).toEqual(['o1', 's1', 's2', 's3', 'o2']);
    });

    it('répond 500 sans détail technique quand la base est en panne', async () => {
      seedTree();
      t.objectives.db.failWrites = true;

      const response = await as(alice).delete('/v2/objectives/o1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' },
      });
      expect(t.objectives.db.objectives.has('o1')).toBe(true);
    });
  });

  it('valide les corps de création', async () => {
    seedObjective(t.objectives.db, { id: 'o1', ownerId: alice.id });

    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['/v2/objectives', { title: '   ' }, 'title'],
      ['/v2/objectives', { title: 'X', dueDate: 'demain' }, 'dueDate'],
      ['/v2/objectives/o1/tasks', { title: 'X', importance: 7, urgency: 1 }, 'importance'],
      ['/v2/objectives/o1/tasks', { title: 'X', importance: 3 }, 'urgency'],
    ];

    for (const [url, body, path] of cases) {
      const response = await as(alice).post(url, body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
    }
  });

  it("répond 500 sans détail technique quand l'enregistrement échoue", async () => {
    t.objectives.db.failWrites = true;

    const response = await as(alice).post('/v2/objectives', { title: 'X' });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('FAIL_TO_SAVE_OBJECTIVE');
  });
});
