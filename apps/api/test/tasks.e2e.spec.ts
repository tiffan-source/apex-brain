import { seedObjective, seedTask } from '@org/objective/testing';
import {
  editedTaskResponseSchema,
  taskDoneResponseSchema,
  todayFocusResponseSchema,
} from '../src/objectives/objectives.schemas';
import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

describe('Pas (e2e)', () => {
  let t: TestApp;
  let alice: ReturnType<TestApp['signIn']>;
  let mallory: ReturnType<TestApp['signIn']>;

  beforeEach(async () => {
    t = await createTestApp();
    alice = t.signIn('alice@apex.test');
    mallory = t.signIn('mallory@apex.test');
    seedObjective(t.objectives.db, { id: 'o1', ownerId: alice.id });
    seedObjective(t.objectives.db, { id: 's1', ownerId: alice.id, parentId: 'o1' });
    seedObjective(t.objectives.db, { id: 's2', ownerId: alice.id, parentId: 'o1' });
    seedObjective(t.objectives.db, { id: 'm1', ownerId: mallory.id });
    seedTask(t.objectives.db, {
      id: 't1',
      ownerId: alice.id,
      objectiveId: 's1',
      title: 'Courir 5 km',
      importance: 3,
      urgency: 2,
    });
    seedTask(t.objectives.db, {
      id: 't2',
      ownerId: alice.id,
      objectiveId: 's1',
      title: 'Étirements',
      importance: 5,
      urgency: 5,
      done: true,
    });
  });

  afterEach(() => t.close());

  it('coche et décoche un pas (UpdateDoneStatusOfTask)', async () => {
    const checked = await t
      .http()
      .put('/v1/tasks/t1/done')
      .set('Authorization', alice.authorization)
      .send({ done: true });

    expect(checked.status).toBe(200);
    expect(taskDoneResponseSchema.parse(checked.body)).toEqual({
      id: 't1',
      title: 'Courir 5 km',
      done: true,
    });
    expect(t.objectives.db.tasks.get('t1')?.done).toBe(true);

    const invalid = await t
      .http()
      .put('/v1/tasks/t1/done')
      .set('Authorization', alice.authorization)
      .send({ done: 'oui' });
    expect(invalid.status).toBe(400);
  });

  it('modifie un pas et le déplace vers une autre étape, sans toucher à ses voisins (EditMyTask)', async () => {
    const response = await t
      .http()
      .patch('/v1/tasks/t1')
      .set('Authorization', alice.authorization)
      .send({ title: 'Courir 10 km', objectiveId: 's2', importance: 4, urgency: 3 });

    expect(response.status).toBe(200);
    expect(editedTaskResponseSchema.parse(response.body)).toEqual({
      id: 't1',
      title: 'Courir 10 km',
      objectiveId: 's2',
      importance: 4,
      urgency: 3,
    });
    expect(t.objectives.db.tasks.get('t1')).toMatchObject({ objectiveId: 's2', title: 'Courir 10 km' });
    expect(t.objectives.db.tasks.get('t2')).toMatchObject({ objectiveId: 's1', done: true });
  });

  it('donne les pas du jour (WhatIsTodayFocus)', async () => {
    const response = await t.http().get('/v1/tasks/today-focus').set('Authorization', alice.authorization);

    expect(response.status).toBe(200);
    expect(todayFocusResponseSchema.parse(response.body).map((task) => task.id)).toEqual(['t2', 't1']);
  });

  it('isole les pas de chaque personne', async () => {
    const check = await t
      .http()
      .put('/v1/tasks/t1/done')
      .set('Authorization', mallory.authorization)
      .send({ done: true });
    expect(check.status).toBe(404);
    expect(check.body.error.code).toBe('TASK_NOT_FOUND');

    const steal = await t
      .http()
      .patch('/v1/tasks/t1')
      .set('Authorization', mallory.authorization)
      .send({ title: 'Volé', objectiveId: 'm1', importance: 1, urgency: 1 });
    expect(steal.status).toBe(404);
    expect(steal.body.error.code).toBe('TASK_NOT_FOUND');

    const moveAway = await t
      .http()
      .patch('/v1/tasks/t1')
      .set('Authorization', alice.authorization)
      .send({ title: 'Courir 5 km', objectiveId: 'm1', importance: 3, urgency: 2 });
    expect(moveAway.status).toBe(404);
    expect(moveAway.body.error.code).toBe('OBJECTIVE_NOT_FOUND');

    const focus = await t.http().get('/v1/tasks/today-focus').set('Authorization', mallory.authorization);
    expect(focus.body).toEqual([]);
    expect(t.objectives.db.tasks.get('t1')).toMatchObject({
      objectiveId: 's1',
      done: false,
      title: 'Courir 5 km',
    });
  });
});
