import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

describe('Plateforme HTTP (e2e)', () => {
  let t: TestApp;

  afterEach(() => t?.close());

  it('répond sur /health sans jeton, hors version', async () => {
    t = await createTestApp();

    const response = await t.http().get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', uptimeSeconds: expect.any(Number) });
  });

  it('publie un document OpenAPI construit depuis les schémas de validation', async () => {
    t = await createTestApp();

    const response = await t.http().get('/docs-json');

    expect(response.status).toBe(200);
    const document = response.body;
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/v2/auth/register',
        '/v2/auth/login',
        '/v2/auth/refresh',
        '/v2/auth/logout',
        '/v2/auth/me',
        '/v2/objectives',
        '/v2/objectives/{objectiveId}',
        '/v2/objectives/{objectiveId}/sub-objectives',
        '/v2/objectives/{objectiveId}/tasks',
        '/v2/tasks/today-focus',
        '/v2/tasks/{taskId}',
        '/v2/bff/objective-tree',
        '/v2/objectives/{objectiveId}/conversation',
        '/v2/objectives/{objectiveId}/assistant',
        '/v2/objectives/{objectiveId}/assistant/messages',
        '/v2/objectives/{objectiveId}/assistant/permission',
        '/health',
      ]),
    );

    const createObjective = document.paths['/v2/objectives'].post;
    const requestSchema = createObjective.requestBody.content['application/json'].schema;
    expect(requestSchema.required).toEqual(['title']);
    expect(Object.keys(requestSchema.properties)).toEqual(['title', 'description', 'why', 'dueDate']);
    expect(createObjective.responses['201'].content['application/json'].schema.properties).toHaveProperty(
      'id',
    );
    expect(document.components.securitySchemes).toHaveProperty('bearer');

    for (const path of ['/v2/objectives/{objectiveId}', '/v2/tasks/{taskId}']) {
      expect(Object.keys(document.paths[path].delete.responses)).toEqual(['204', '404']);
    }
  });

  it('sert la page /docs', async () => {
    t = await createTestApp();

    const response = await t.http().get('/docs/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger');
  });

  it("n'expose pas la documentation quand elle est désactivée", async () => {
    t = await createTestApp({ SWAGGER_ENABLED: 'false' });

    expect((await t.http().get('/docs-json')).status).toBe(404);
  });

  it('rend les erreurs du framework sous la même forme', async () => {
    t = await createTestApp();
    const { authorization } = t.signIn('alice@apex.test');

    const unknownRoute = await t.http().get('/v2/inconnu').set('Authorization', authorization);
    expect(unknownRoute.status).toBe(404);
    expect(unknownRoute.body.error.code).toBe('NOT_FOUND');

    // La v1 est retirée (ADR 0007) : ses routes n'existent plus.
    const removed = await t.http().get('/v1/auth/me').set('Authorization', authorization);
    expect(removed.status).toBe(404);
    expect(removed.body.error.code).toBe('NOT_FOUND');

    const malformed = await t
      .http()
      .post('/v2/objectives')
      .set('Authorization', authorization)
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('BAD_REQUEST');
  });

  it("cache le détail d'une panne inattendue", async () => {
    t = await createTestApp();
    const { authorization } = t.signIn('alice@apex.test');
    vi.spyOn(t.objectives.getObjectiveTreeQuery, 'execute').mockRejectedValueOnce(
      new Error('relation "objectives" does not exist (host db.internal:5432)'),
    );

    const response = await t.http().get('/v2/bff/objective-tree').set('Authorization', authorization);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' },
    });
  });

  it('limite les tentatives de connexion', async () => {
    t = await createTestApp({ THROTTLE_AUTH_LIMIT: '2' });
    const attempt = () =>
      t.http().post('/v2/auth/login').send({ email: 'alice@apex.test', password: 'faux' });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('ajoute les en-têtes de sécurité et la politique CORS', async () => {
    t = await createTestApp();

    const response = await t
      .http()
      .options('/v2/objectives')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();

    const deletion = await t
      .http()
      .options('/v2/tasks/t1')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'DELETE');
    expect(deletion.headers['access-control-allow-methods']).toContain('DELETE');

    const foreign = await t
      .http()
      .options('/v2/objectives')
      .set('Origin', 'https://ailleurs.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });
});
