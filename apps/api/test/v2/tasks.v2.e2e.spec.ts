import { seedObjective, seedTask } from '@org/objective/testing';
import { todayFocusResponseSchema } from '../../src/objectives/objectives.schemas';
import { taskCommandResponseSchema } from '../../src/objectives/v2/objectives.v2.schemas';
import type { TestApp } from '../support/test-app';
import { createTestApp } from '../support/test-app';

describe('v2 — commandes sur un pas (e2e)', () => {
  let t: TestApp;
  let alice: ReturnType<TestApp['signIn']>;
  let mallory: ReturnType<TestApp['signIn']>;

  beforeEach(async () => {
    t = await createTestApp();
    alice = t.signIn('alice@apex.test');
    mallory = t.signIn('mallory@apex.test');
    seedObjective(t.objectives.db, { id: 'o1', ownerId: alice.id });
    seedObjective(t.objectives.db, { id: 's1', ownerId: alice.id, parentId: 'o1' });
    seedObjective(t.objectives.db, { id: 'm1', ownerId: mallory.id });
    seedTask(t.objectives.db, {
      id: 't1',
      ownerId: alice.id,
      objectiveId: 's1',
      title: 'Courir 5 km',
      importance: 3,
      urgency: 2,
    });
  });

  afterEach(() => t.close());

  const patch = (who: { authorization: string }, path: string, body?: object) =>
    t.http().patch(path).set('Authorization', who.authorization).send(body);

  it('renomme un pas et rend le pas entier (renameTask)', async () => {
    const response = await patch(alice, '/v2/tasks/t1/rename', { title: 'Courir 10 km' });

    expect(response.status).toBe(200);
    expect(taskCommandResponseSchema.parse(response.body)).toEqual({
      id: 't1',
      title: 'Courir 10 km',
      importance: 3,
      urgency: 2,
      done: false,
      objectiveId: 's1',
    });
  });

  it("revoit l'importance et l'urgence (reprioritizeTask), de 1 à 5 seulement", async () => {
    const response = await patch(alice, '/v2/tasks/t1/reprioritize', { importance: 5, urgency: 4 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ importance: 5, urgency: 4, title: 'Courir 5 km' });

    const invalid = await patch(alice, '/v2/tasks/t1/reprioritize', { importance: 6, urgency: 4 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('fait un pas puis le remet à faire ; rejouer la commande réussit (completeTask, reopenTask)', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const completed = await patch(alice, '/v2/tasks/t1/complete');
      expect(completed.status).toBe(200);
      expect(taskCommandResponseSchema.parse(completed.body).done).toBe(true);
    }
    expect(t.objectives.db.tasks.get('t1')?.done).toBe(true);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reopened = await patch(alice, '/v2/tasks/t1/reopen');
      expect(reopened.status).toBe(200);
      expect(taskCommandResponseSchema.parse(reopened.body).done).toBe(false);
    }
    expect(t.objectives.db.tasks.get('t1')?.done).toBe(false);
  });

  it("déplace un pas vers un autre objectif, ou nulle part s'il y est déjà (moveTask)", async () => {
    const moved = await patch(alice, '/v2/tasks/t1/move', { objectiveId: 'o1' });
    expect(moved.status).toBe(200);
    expect(taskCommandResponseSchema.parse(moved.body).objectiveId).toBe('o1');
    expect(t.objectives.db.tasks.get('t1')?.objectiveId).toBe('o1');

    const again = await patch(alice, '/v2/tasks/t1/move', { objectiveId: 'o1' });
    expect(again.status).toBe(200);
    expect(again.body.objectiveId).toBe('o1');
  });

  it("ne déplace pas un pas vers l'objectif d'une autre personne (OBJECTIVE_NOT_FOUND)", async () => {
    const response = await patch(alice, '/v2/tasks/t1/move', { objectiveId: 'm1' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('OBJECTIVE_NOT_FOUND');
    expect(t.objectives.db.tasks.get('t1')?.objectiveId).toBe('s1');
  });

  it("ne laisse personne d'autre toucher au pas (TASK_NOT_FOUND)", async () => {
    const attempts = [
      await patch(mallory, '/v2/tasks/t1/rename', { title: 'Volé' }),
      await patch(mallory, '/v2/tasks/t1/reprioritize', { importance: 1, urgency: 1 }),
      await patch(mallory, '/v2/tasks/t1/move', { objectiveId: 'm1' }),
      await patch(mallory, '/v2/tasks/t1/complete'),
      await patch(mallory, '/v2/tasks/t1/reopen'),
      await t.http().delete('/v2/tasks/t1').set('Authorization', mallory.authorization),
    ];

    for (const response of attempts) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('TASK_NOT_FOUND');
    }
    expect(t.objectives.db.tasks.get('t1')).toMatchObject({
      title: 'Courir 5 km',
      importance: 3,
      done: false,
      objectiveId: 's1',
    });
  });

  it('supprime un pas sans toucher à ses voisins, puis répond 404 (deleteTask)', async () => {
    seedTask(t.objectives.db, { id: 't2', ownerId: alice.id, objectiveId: 's1', done: true });
    const remove = () => t.http().delete('/v2/tasks/t1').set('Authorization', alice.authorization);

    const response = await remove();

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
    expect([...t.objectives.db.tasks.keys()]).toEqual(['t2']);
    expect(t.objectives.db.objectives.has('s1')).toBe(true);

    const again = await remove();
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('TASK_NOT_FOUND');
  });

  it('répond 500 sans détail technique quand la base est en panne', async () => {
    t.objectives.db.failWrites = true;

    const response = await t.http().delete('/v2/tasks/t1').set('Authorization', alice.authorization);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' },
    });
    expect(t.objectives.db.tasks.has('t1')).toBe(true);
  });

  it('déplace un pas sans toucher à ses voisins (moveTask)', async () => {
    seedObjective(t.objectives.db, { id: 's2', ownerId: alice.id, parentId: 'o1' });
    seedTask(t.objectives.db, { id: 't2', ownerId: alice.id, objectiveId: 's1', done: true });

    const response = await patch(alice, '/v2/tasks/t1/move', { objectiveId: 's2' });

    expect(response.status).toBe(200);
    expect(t.objectives.db.tasks.get('t1')).toMatchObject({ objectiveId: 's2', title: 'Courir 5 km' });
    expect(t.objectives.db.tasks.get('t2')).toMatchObject({ objectiveId: 's1', done: true });
  });

  it('donne le focus du jour (whatIsTodayFocus)', async () => {
    const response = await t.http().get('/v2/tasks/today-focus').set('Authorization', alice.authorization);

    expect(response.status).toBe(200);
    expect(todayFocusResponseSchema.parse(response.body).map((task) => task.id)).toEqual(['t1']);

    // Le focus du jour ne montre que les pas de la personne.
    seedTask(t.objectives.db, {
      id: 'mt1',
      ownerId: mallory.id,
      objectiveId: 'm1',
      importance: 5,
      urgency: 5,
    });
    const mine = await t.http().get('/v2/tasks/today-focus').set('Authorization', alice.authorization);
    const theirs = await t.http().get('/v2/tasks/today-focus').set('Authorization', mallory.authorization);
    expect(mine.body.map((task: { id: string }) => task.id)).toEqual(['t1']);
    expect(theirs.body.map((task: { id: string }) => task.id)).toEqual(['mt1']);
  });
});
