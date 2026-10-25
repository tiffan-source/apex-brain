import {
  objectiveResponseSchema,
  objectivesResponseSchema,
  subObjectiveResponseSchema,
  createdTaskResponseSchema,
} from '../src/objectives/objectives.schemas';
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
