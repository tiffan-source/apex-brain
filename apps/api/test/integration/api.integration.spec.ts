import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InteractiveAIProvider } from '@org/ai';
import { ScriptedAIProvider } from '@org/ai/testing';
import request from 'supertest';
import { ProductionAdaptersModule } from '../../src/adapters/production-adapters.module';
import { AppModule } from '../../src/app.module';
import { loadEnvironment } from '../../src/config/environment';
import { configureApp } from '../../src/configure-app';
import type { ObjectiveTreeNodeResponse } from '../../src/objectives/bff/objective-tree.schemas';

const enabled = process.env['SUPABASE_INTEGRATION'] === '1';

/**
 * L'API complète contre un vrai Supabase (`supabase start`) : seuls Gemini (une IA scriptée) et
 * Firestore (état des workflows en mémoire) sont remplacés.
 */
describe.skipIf(!enabled)('API contre Supabase (intégration)', () => {
  let app: INestApplication;
  const ai = new ScriptedAIProvider();

  beforeAll(async () => {
    const environment = loadEnvironment({
      ...process.env,
      SUPABASE_URL: process.env['SUPABASE_URL'] ?? process.env['API_URL'],
      SUPABASE_PUBLISHABLE_KEY: process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['ANON_KEY'],
      SUPABASE_SECRET_KEY: process.env['SUPABASE_SECRET_KEY'] ?? process.env['SERVICE_ROLE_KEY'],
      GEMINI_API_KEY: 'non-utilisée',
      WORKFLOW_STATE_STORE: 'memory',
      THROTTLE_AUTH_LIMIT: '1000',
      THROTTLE_DEFAULT_LIMIT: '10000',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register({ environment, adapters: ProductionAdaptersModule.register(environment) }),
      ],
    })
      .overrideProvider(InteractiveAIProvider)
      .useValue(ai)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, environment);
    await app.init();
  });

  afterAll(() => app?.close());

  const http = () => request(app.getHttpServer());

  /** L'arbre BFF de la personne. */
  const tree = async (who: { authorization: string }): Promise<{ objectives: ObjectiveTreeNodeResponse[] }> =>
    (await http().get('/v2/bff/objective-tree').set('Authorization', who.authorization)).body;

  /** Les titres de l'arbre, en profondeur : l'objectif, ses étapes, puis ses pas. */
  const titles = ({ objectives }: { objectives: ObjectiveTreeNodeResponse[] }): string[] =>
    objectives.flatMap((node) => [
      node.title,
      ...titles({ objectives: node.subObjectives }),
      ...node.tasks.map((task) => task.title),
    ]);

  const register = async (label: string) => {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@apex.test`;
    const response = await http().post('/v2/auth/register').send({ email, password: 'secret-123456' });
    expect(response.status).toBe(201);
    return {
      id: response.body.user.id as string,
      email,
      refreshToken: response.body.session.refreshToken as string,
      authorization: `Bearer ${response.body.session.accessToken}`,
    };
  };

  const waitForStatus = async (objectiveId: string, authorization: string, status: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await http()
        .get(`/v2/objectives/${objectiveId}/assistant`)
        .set('Authorization', authorization);
      if (response.body.status === status) return response.body;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`statut ${status} jamais atteint`);
  };

  it("couvre chaque cas d'usage, au nom de sa propriétaire seulement", async () => {
    const alice = await register('alice');
    const mallory = await register('mallory');
    const as = (who: { authorization: string }) => ({ Authorization: who.authorization });

    // Objectif, étape, pas
    const objective = await http()
      .post('/v2/objectives')
      .set(as(alice))
      .send({ title: 'Courir un marathon', dueDate: '2027-04-01' });
    expect(objective.status).toBe(201);
    const objectiveId = objective.body.id as string;

    const stage = await http()
      .post(`/v2/objectives/${objectiveId}/sub-objectives`)
      .set(as(alice))
      .send({ title: 'Préparer le corps' });
    expect(stage.status).toBe(201);

    const first = await http()
      .post(`/v2/objectives/${stage.body.id}/tasks`)
      .set(as(alice))
      .send({ title: 'Courir 5 km', importance: 4, urgency: 2 });
    const second = await http()
      .post(`/v2/objectives/${stage.body.id}/tasks`)
      .set(as(alice))
      .send({ title: 'Étirements', importance: 3, urgency: 3 });
    expect([first.status, second.status]).toEqual([201, 201]);

    // Faire, renommer, revoir la priorité, déplacer
    expect((await http().patch(`/v2/tasks/${first.body.id}/complete`).set(as(alice))).status).toBe(200);
    expect(
      (
        await http()
          .patch(`/v2/tasks/${second.body.id}/rename`)
          .set(as(alice))
          .send({ title: 'Étirements du soir' })
      ).status,
    ).toBe(200);
    expect(
      (
        await http()
          .patch(`/v2/tasks/${second.body.id}/reprioritize`)
          .set(as(alice))
          .send({ importance: 3, urgency: 4 })
      ).status,
    ).toBe(200);
    const moved = await http().patch(`/v2/tasks/${second.body.id}/move`).set(as(alice)).send({ objectiveId });
    expect(moved.body).toMatchObject({ id: second.body.id, objectiveId });

    const renamed = await http()
      .patch(`/v2/objectives/${objectiveId}/rename`)
      .set(as(alice))
      .send({ title: 'Courir le marathon de Paris' });
    expect(renamed.body).toMatchObject({ id: objectiveId, title: 'Courir le marathon de Paris' });
    const withoutDeadline = await http()
      .patch(`/v2/objectives/${objectiveId}/remove-deadline`)
      .set(as(alice));
    expect(withoutDeadline.body).toMatchObject({ id: objectiveId, dueDate: null });

    const [root] = (await tree(alice)).objectives;
    expect(root).toMatchObject({ id: objectiveId, title: 'Courir le marathon de Paris' });
    expect(root.subObjectives.map((sub) => sub.id)).toEqual([stage.body.id]);
    expect(root.subObjectives[0].tasks).toEqual([expect.objectContaining({ id: first.body.id, done: true })]);
    expect(root.tasks).toEqual([
      expect.objectContaining({ id: second.body.id, title: 'Étirements du soir', done: false }),
    ]);

    const focus = await http().get('/v2/tasks/today-focus').set(as(alice));
    expect(focus.body.map((task: { id: string }) => task.id)).toEqual([second.body.id, first.body.id]);

    // Isolation
    expect(await tree(mallory)).toEqual({ objectives: [] });
    expect(
      (await http().patch(`/v2/objectives/${objectiveId}/rename`).set(as(mallory)).send({ title: 'Volé' }))
        .status,
    ).toBe(404);
    expect((await http().patch(`/v2/tasks/${first.body.id}/reopen`).set(as(mallory))).status).toBe(404);
    expect((await http().get(`/v2/objectives/${objectiveId}/conversation`).set(as(mallory))).status).toBe(
      404,
    );
    expect((await http().get(`/v2/objectives/${objectiveId}/assistant`).set(as(mallory))).status).toBe(404);

    // L'assistant : lecture de l'arbre, puis ajout d'un pas avec l'accord d'Alice
    ai.willRespond(
      ai.toolCalls({ id: 'call-1', name: 'getObjectiveTree', arguments: { id: objectiveId } }),
      ai.toolCalls({
        id: 'call-2',
        name: 'createTask',
        arguments: { objectiveId: stage.body.id, title: 'Fractionné', importance: 4, urgency: 3 },
      }),
      ai.text('Je te propose un fractionné, il est ajouté.'),
    );

    expect(
      (
        await http()
          .post(`/v2/objectives/${objectiveId}/assistant/messages`)
          .set(as(alice))
          .send({ message: 'Que faire ensuite ?' })
      ).status,
    ).toBe(202);
    const waiting = await waitForStatus(objectiveId, alice.authorization, 'awaiting-permission');
    expect(waiting.pendingToolCall).toMatchObject({ id: 'call-2', name: 'createTask' });

    expect(
      (
        await http()
          .post(`/v2/objectives/${objectiveId}/assistant/permission`)
          .set(as(alice))
          .send({ granted: true, toolCallId: 'call-2' })
      ).status,
    ).toBe(202);
    const done = await waitForStatus(objectiveId, alice.authorization, 'ready');
    expect(done.lastRegisteredMessage).toMatchObject({
      sender: 'AI',
      content: 'Je te propose un fractionné, il est ajouté.',
    });

    const conversation = await http().get(`/v2/objectives/${objectiveId}/conversation`).set(as(alice));
    expect(conversation.body.messages.map((message: { sender: string }) => message.sender)).toEqual([
      alice.id,
      'AI',
    ]);

    expect(titles(await tree(alice))).toContain('Fractionné');

    // Session : renouveler, se déconnecter
    const refreshed = await http().post('/v2/auth/refresh').send({ refreshToken: alice.refreshToken });
    expect(refreshed.status).toBe(200);
    const renewed = `Bearer ${refreshed.body.session.accessToken}`;
    expect((await http().get('/v2/auth/me').set('Authorization', renewed)).body.email).toBe(alice.email);
    expect((await http().post('/v2/auth/logout').set('Authorization', renewed)).status).toBe(204);
  });

  it('supprime un pas, une étape puis un objectif et sa conversation, au nom de sa propriétaire seulement', async () => {
    const alice = await register('alice');
    const mallory = await register('mallory');
    const as = (who: { authorization: string }) => ({ Authorization: who.authorization });
    const aliceTitles = async () => titles(await tree(alice));

    const objectiveId = (await http().post('/v2/objectives').set(as(alice)).send({ title: 'Objectif' })).body
      .id as string;
    const stage = await http()
      .post(`/v2/objectives/${objectiveId}/sub-objectives`)
      .set(as(alice))
      .send({ title: 'Étape' });
    const addTask = (holderId: string, title: string) =>
      http()
        .post(`/v2/objectives/${holderId}/tasks`)
        .set(as(alice))
        .send({ title, importance: 3, urgency: 3 });
    const first = await addTask(stage.body.id, 'Premier pas');
    await addTask(stage.body.id, 'Deuxième pas');
    await addTask(objectiveId, 'Pas sur l’objectif');

    ai.willRespond(ai.text('Bonjour.'));
    await http()
      .post(`/v2/objectives/${objectiveId}/assistant/messages`)
      .set(as(alice))
      .send({ message: 'Salut' });
    await waitForStatus(objectiveId, alice.authorization, 'ready');

    // Rien ne bouge au nom de quelqu'un d'autre
    expect((await http().delete(`/v2/tasks/${first.body.id}`).set(as(mallory))).status).toBe(404);
    expect((await http().delete(`/v2/objectives/${stage.body.id}`).set(as(mallory))).status).toBe(404);
    expect((await http().delete(`/v2/objectives/${objectiveId}`).set(as(mallory))).status).toBe(404);
    await expect(aliceTitles()).resolves.toEqual([
      'Objectif',
      'Étape',
      'Premier pas',
      'Deuxième pas',
      'Pas sur l’objectif',
    ]);

    // Un pas, puis une étape et ce qu'elle porte
    expect((await http().delete(`/v2/tasks/${first.body.id}`).set(as(alice))).status).toBe(204);
    await expect(aliceTitles()).resolves.toEqual(['Objectif', 'Étape', 'Deuxième pas', 'Pas sur l’objectif']);

    expect((await http().delete(`/v2/objectives/${stage.body.id}`).set(as(alice))).status).toBe(204);
    await expect(aliceTitles()).resolves.toEqual(['Objectif', 'Pas sur l’objectif']);
    expect((await http().get(`/v2/objectives/${objectiveId}/conversation`).set(as(alice))).status).toBe(200);

    // L'objectif, sa conversation et son assistant
    expect((await http().delete(`/v2/objectives/${objectiveId}`).set(as(alice))).status).toBe(204);
    await expect(aliceTitles()).resolves.toEqual([]);
    expect((await http().get(`/v2/objectives/${objectiveId}/conversation`).set(as(alice))).status).toBe(404);
    expect((await http().get(`/v2/objectives/${objectiveId}/assistant`).set(as(alice))).status).toBe(404);
    expect((await http().delete(`/v2/objectives/${objectiveId}`).set(as(alice))).status).toBe(404);
  });
});
