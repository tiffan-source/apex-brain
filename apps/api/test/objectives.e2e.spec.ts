import {
  objectiveResponseSchema,
  objectivesResponseSchema,
  subObjectiveResponseSchema,
  createdTaskResponseSchema,
} from '../src/objectives/objectives.schemas';
import { seedObjective, seedTask } from '@org/objective/testing';
import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

describe('Objectifs (e2e)', () => {
  let t: TestApp;
  let alice: ReturnType<TestApp['signIn']>;
  let mallory: ReturnType<TestApp['signIn']>;

  beforeEach(async () => {
    t = await createTestApp();
    alice = t.signIn('alice@apex.test');
    mallory = t.signIn('mallory@apex.test');
  });

  afterEach(() => t.close());

  const createObjective = async (body: Record<string, unknown> = { title: 'Courir un marathon' }) => {
    const response = await t
      .http()
      .post('/v1/objectives')
      .set('Authorization', alice.authorization)
      .send(body);
    expect(response.status).toBe(201);
    return objectiveResponseSchema.parse(response.body);
  };

  it('définit un objectif et le retrouve au chargement (CreateObjective, GetAllObjectiveAndTask)', async () => {
    const created = await createObjective({
      title: '  Courir un marathon  ',
      why: 'Me prouver que je peux',
      dueDate: '2027-04-01',
    });

    expect(created).toEqual({
      id: expect.any(String),
      title: 'Courir un marathon',
      why: 'Me prouver que je peux',
      dueDate: '2027-04-01T00:00:00.000Z',
    });

    const list = await t.http().get('/v1/objectives').set('Authorization', alice.authorization);
    expect(list.status).toBe(200);
    expect(objectivesResponseSchema.parse(list.body)).toEqual({
      objectives: [
        {
          id: created.id,
          title: 'Courir un marathon',
          description: '',
          why: 'Me prouver que je peux',
          dueDate: '2027-04-01T00:00:00.000Z',
          parentObjective: null,
          done: false,
        },
      ],
      tasks: [],
    });
  });

  it('modifie un objectif et retire son échéance (EditObjective)', async () => {
    const created = await createObjective({
      title: 'Courir',
      description: 'Avant',
      dueDate: '2027-04-01T08:00:00+02:00',
    });

    const edited = await t
      .http()
      .patch(`/v1/objectives/${created.id}`)
      .set('Authorization', alice.authorization)
      .send({ title: 'Courir un marathon', dueDate: null });

    expect(edited.status).toBe(200);
    expect(objectiveResponseSchema.parse(edited.body)).toEqual({
      id: created.id,
      title: 'Courir un marathon',
      description: 'Avant',
    });
  });

  it('ajoute une étape et un pas (AddSubObjective, AddTaskToObjective)', async () => {
    const objective = await createObjective();

    const stage = await t
      .http()
      .post(`/v1/objectives/${objective.id}/sub-objectives`)
      .set('Authorization', alice.authorization)
      .send({ title: 'Préparer le corps' });
    expect(stage.status).toBe(201);
    const { id: stageId } = subObjectiveResponseSchema.parse(stage.body);

    const task = await t
      .http()
      .post(`/v1/objectives/${stageId}/tasks`)
      .set('Authorization', alice.authorization)
      .send({ title: 'Courir 5 km', importance: 4, urgency: 2 });
    expect(task.status).toBe(201);
    expect(createdTaskResponseSchema.parse(task.body)).toEqual({
      id: expect.any(String),
      title: 'Courir 5 km',
      importance: 4,
      urgency: 2,
    });

    const list = objectivesResponseSchema.parse(
      (await t.http().get('/v1/objectives').set('Authorization', alice.authorization)).body,
    );
    expect(list.objectives.map((row) => [row.id, row.parentObjective])).toEqual([
      [objective.id, null],
      [stageId, objective.id],
    ]);
    expect(list.tasks).toEqual([
      {
        id: task.body.id,
        title: 'Courir 5 km',
        importance: 4,
        urgency: 2,
        done: false,
        objectiveId: stageId,
      },
    ]);
  });

  describe('suppression (DeleteObjective)', () => {
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

    const remove = (id: string, who = alice) =>
      t.http().delete(`/v1/objectives/${id}`).set('Authorization', who.authorization);

    const list = async (who = alice) => {
      const response = await t.http().get('/v1/objectives').set('Authorization', who.authorization);
      const { objectives, tasks } = objectivesResponseSchema.parse(response.body);
      return { objectives: objectives.map((row) => row.id), tasks: tasks.map((row) => row.id) };
    };

    it('supprime un objectif avec ses étapes et leurs pas, sans toucher au reste', async () => {
      seedTree();

      const response = await remove('o1');

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      await expect(list()).resolves.toEqual({ objectives: ['o2'], tasks: ['t4'] });
    });

    it("supprime une étape avec ce qu'elle porte, sans toucher à son objectif ni à ses voisines", async () => {
      seedTree();

      expect((await remove('s1')).status).toBe(204);

      await expect(list()).resolves.toEqual({ objectives: ['o1', 's3', 'o2'], tasks: ['t3', 't4'] });
    });

    it('répond 404 pour un objectif inconnu ou déjà supprimé', async () => {
      seedTree();
      expect((await remove('o1')).status).toBe(204);

      for (const id of ['o1', 's1', 'inconnu']) {
        const response = await remove(id);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('OBJECTIVE_NOT_FOUND');
      }
    });

    it("demande un jeton et ne supprime rien pour quelqu'un d'autre", async () => {
      seedTree();

      expect((await t.http().delete('/v1/objectives/o1')).status).toBe(401);
      const stolen = await remove('o1', mallory);

      expect(stolen.status).toBe(404);
      expect(stolen.body.error.code).toBe('OBJECTIVE_NOT_FOUND');
      await expect(list()).resolves.toEqual({
        objectives: ['o1', 's1', 's2', 's3', 'o2'],
        tasks: ['t1', 't2', 't3', 't4'],
      });
    });

    it('répond 500 sans détail technique quand la base est en panne', async () => {
      seedTree();
      t.objectives.db.failWrites = true;

      const response = await remove('o1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' },
      });
      expect(t.objectives.db.objectives.has('o1')).toBe(true);
    });
  });

  it('valide les corps de requête', async () => {
    const objective = await createObjective();

    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['/v1/objectives', { title: '   ' }, 'title'],
      ['/v1/objectives', { title: 'X', dueDate: 'demain' }, 'dueDate'],
      [`/v1/objectives/${objective.id}/tasks`, { title: 'X', importance: 7, urgency: 1 }, 'importance'],
      [`/v1/objectives/${objective.id}/tasks`, { title: 'X', importance: 3 }, 'urgency'],
    ];

    for (const [url, body, path] of cases) {
      const response = await t.http().post(url).set('Authorization', alice.authorization).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
    }
  });

  it('isole les objectifs de chaque personne', async () => {
    const objective = await createObjective();

    const list = await t.http().get('/v1/objectives').set('Authorization', mallory.authorization);
    expect(list.body).toEqual({ objectives: [], tasks: [] });

    const attempts = [
      t
        .http()
        .patch(`/v1/objectives/${objective.id}`)
        .set('Authorization', mallory.authorization)
        .send({ title: 'Volé' }),
      t
        .http()
        .post(`/v1/objectives/${objective.id}/sub-objectives`)
        .set('Authorization', mallory.authorization)
        .send({ title: 'Intrusion' }),
      t
        .http()
        .post(`/v1/objectives/${objective.id}/tasks`)
        .set('Authorization', mallory.authorization)
        .send({ title: 'Intrusion', importance: 1, urgency: 1 }),
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('OBJECTIVE_NOT_FOUND');
    }

    const intact = objectivesResponseSchema.parse(
      (await t.http().get('/v1/objectives').set('Authorization', alice.authorization)).body,
    );
    expect(intact.objectives).toEqual([
      expect.objectContaining({ id: objective.id, title: 'Courir un marathon' }),
    ]);
    expect(intact.tasks).toEqual([]);
  });

  it("répond 500 sans détail technique quand l'enregistrement échoue", async () => {
    t.objectives.db.failWrites = true;

    const response = await t
      .http()
      .post('/v1/objectives')
      .set('Authorization', alice.authorization)
      .send({ title: 'X' });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('FAIL_TO_SAVE_OBJECTIVE');
  });
});
