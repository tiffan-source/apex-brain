import { seedObjective, seedTask } from '@org/objective/testing';
import { objectiveTreeResponseSchema } from '../../src/objectives/bff/objective-tree.schemas';
import type { TestApp } from '../support/test-app';
import { createTestApp } from '../support/test-app';

describe('v2 — BFF : arbre des objectifs (e2e)', () => {
  let t: TestApp;
  let alice: ReturnType<TestApp['signIn']>;
  let mallory: ReturnType<TestApp['signIn']>;

  beforeEach(async () => {
    t = await createTestApp();
    alice = t.signIn('alice@apex.test');
    mallory = t.signIn('mallory@apex.test');
  });

  afterEach(() => t.close());

  const tree = (who: { authorization: string }) =>
    t.http().get('/v2/bff/objective-tree').set('Authorization', who.authorization);

  it("rend l'arbre emboîté de la personne, `done` tel qu'il est en base (getObjectiveTree)", async () => {
    seedObjective(t.objectives.db, {
      id: 'o1',
      ownerId: alice.id,
      title: 'Courir un marathon',
      why: 'Pour moi',
      dueDate: new Date('2027-04-01T00:00:00.000Z'),
    });
    seedObjective(t.objectives.db, {
      id: 's1',
      ownerId: alice.id,
      parentId: 'o1',
      title: 'Préparer le corps',
    });
    seedObjective(t.objectives.db, { id: 's2', ownerId: alice.id, parentId: 's1', title: 'Dormir' });
    seedObjective(t.objectives.db, { id: 'o2', ownerId: alice.id, title: 'Lire', done: true });
    seedTask(t.objectives.db, {
      id: 't1',
      ownerId: alice.id,
      objectiveId: 's2',
      title: 'Se coucher tôt',
      done: true,
    });
    seedObjective(t.objectives.db, { id: 'm1', ownerId: mallory.id });

    const response = await tree(alice);

    expect(response.status).toBe(200);
    expect(objectiveTreeResponseSchema.parse(response.body)).toEqual({
      objectives: [
        {
          id: 'o1',
          title: 'Courir un marathon',
          description: '',
          why: 'Pour moi',
          dueDate: '2027-04-01T00:00:00.000Z',
          // Tous ses pas sont faits, mais rien ne tient la colonne à jour : on rend la base.
          done: false,
          tasks: [],
          subObjectives: [
            {
              id: 's1',
              title: 'Préparer le corps',
              description: '',
              why: '',
              dueDate: null,
              done: false,
              tasks: [],
              subObjectives: [
                {
                  id: 's2',
                  title: 'Dormir',
                  description: '',
                  why: '',
                  dueDate: null,
                  done: false,
                  tasks: [{ id: 't1', title: 'Se coucher tôt', importance: 3, urgency: 2, done: true }],
                  subObjectives: [],
                },
              ],
            },
          ],
        },
        {
          id: 'o2',
          title: 'Lire',
          description: '',
          why: '',
          dueDate: null,
          done: true,
          tasks: [],
          subObjectives: [],
        },
      ],
    });
  });

  it("ne montre jamais l'arbre d'une autre personne", async () => {
    seedObjective(t.objectives.db, { id: 'o1', ownerId: alice.id });
    seedTask(t.objectives.db, { id: 't1', ownerId: alice.id, objectiveId: 'o1' });

    const response = await tree(mallory);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ objectives: [] });
  });

  it('suit les commandes : ce qui est créé apparaît dans l’arbre', async () => {
    const created = await t
      .http()
      .post('/v2/objectives')
      .set('Authorization', alice.authorization)
      .send({ title: 'Apprendre le piano' });
    await t
      .http()
      .post(`/v2/objectives/${created.body.id}/tasks`)
      .set('Authorization', alice.authorization)
      .send({ title: 'Gammes', importance: 3, urgency: 3 });

    const { objectives } = objectiveTreeResponseSchema.parse((await tree(alice)).body);

    expect(objectives).toHaveLength(1);
    expect(objectives[0]).toMatchObject({ title: 'Apprendre le piano', tasks: [{ title: 'Gammes' }] });
  });

  it('exige une personne connectée', async () => {
    const response = await t.http().get('/v2/bff/objective-tree');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});
