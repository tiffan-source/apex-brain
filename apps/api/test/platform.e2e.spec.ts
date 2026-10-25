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
        '/v1/auth/register',
        '/v1/auth/login',
        '/v1/auth/refresh',
        '/v1/auth/logout',
        '/v1/auth/me',
        '/v1/objectives',
        '/v1/objectives/{objectiveId}',
        '/v1/objectives/{objectiveId}/sub-objectives',
        '/v1/objectives/{objectiveId}/tasks',
        '/v1/tasks/today-focus',
        '/v1/tasks/{taskId}',
        '/v1/tasks/{taskId}/done',
        '/v1/objectives/{objectiveId}/conversation',
        '/v1/objectives/{objectiveId}/assistant',
        '/v1/objectives/{objectiveId}/assistant/messages',
        '/v1/objectives/{objectiveId}/assistant/permission',
        '/health',
      ]),
    );

    const createObjective = document.paths['/v1/objectives'].post;
    const requestSchema = createObjective.requestBody.content['application/json'].schema;
    expect(requestSchema.required).toEqual(['title']);
    expect(Object.keys(requestSchema.properties)).toEqual(['title', 'description', 'why', 'dueDate']);
    expect(createObjective.responses['201'].content['application/json'].schema.properties).toHaveProperty(
      'id',
    );
    expect(document.components.securitySchemes).toHaveProperty('bearer');
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

    const unknownRoute = await t.http().get('/v1/inconnu').set('Authorization', authorization);
    expect(unknownRoute.status).toBe(404);
    expect(unknownRoute.body.error.code).toBe('NOT_FOUND');

    const malformed = await t
      .http()
      .post('/v1/objectives')
      .set('Authorization', authorization)
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('BAD_REQUEST');
  });

  it("cache le détail d'une panne inattendue", async () => {
    t = await createTestApp();
    const { authorization } = t.signIn('alice@apex.test');
    vi.spyOn(t.objectives.getAllObjectiveAndTaskQuery, 'execute').mockRejectedValueOnce(
      new Error('relation "objectives" does not exist (host db.internal:5432)'),
    );

    const response = await t.http().get('/v1/objectives').set('Authorization', authorization);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' },
    });
  });

  it('limite les tentatives de connexion', async () => {
    t = await createTestApp({ THROTTLE_AUTH_LIMIT: '2' });
    const attempt = () =>
      t.http().post('/v1/auth/login').send({ email: 'alice@apex.test', password: 'faux' });

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
      .options('/v1/objectives')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();

    const foreign = await t
      .http()
      .options('/v1/objectives')
      .set('Origin', 'https://ailleurs.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });
});
