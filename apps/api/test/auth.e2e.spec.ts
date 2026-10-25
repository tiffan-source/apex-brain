import {
  registeredResponseSchema,
  signedInResponseSchema,
  userResponseSchema,
} from '../src/auth/auth.schemas';
import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

describe('Authentification (e2e)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(() => t.close());

  it('inscrit une personne et ouvre sa session (CreateNewUserUseCase)', async () => {
    const response = await t
      .http()
      .post('/v1/auth/register')
      .send({ email: ' Alice@Apex.test ', password: 'secret123' });

    expect(response.status).toBe(201);
    const body = registeredResponseSchema.parse(response.body);
    expect(body.user).toEqual({ id: expect.any(String), email: 'alice@apex.test', name: 'alice@apex.test' });
    expect(body.session).not.toBeNull();
  });

  it('refuse une adresse déjà inscrite, un mot de passe trop court et un e-mail mal formé', async () => {
    await t.http().post('/v1/auth/register').send({ email: 'alice@apex.test', password: 'secret123' });

    const duplicate = await t
      .http()
      .post('/v1/auth/register')
      .send({ email: 'alice@apex.test', password: 'secret123' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('USER_ALREADY_EXIST');

    const weak = await t.http().post('/v1/auth/register').send({ email: 'bob@apex.test', password: '123' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');

    const invalid = await t
      .http()
      .post('/v1/auth/register')
      .send({ email: 'pas-un-email', password: 'secret123' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: [{ path: 'email', message: expect.any(String) }],
      },
    });
  });

  it('connecte, reconnaît, renouvelle et déconnecte (LogUserIn, GetCurrentUser, RefreshSession, LogUserOut)', async () => {
    t.auth.seedAccount('alice@apex.test', 'secret123', 'Alice');

    const wrong = await t.http().post('/v1/auth/login').send({ email: 'alice@apex.test', password: 'faux' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const login = await t
      .http()
      .post('/v1/auth/login')
      .send({ email: 'alice@apex.test', password: 'secret123' });
    expect(login.status).toBe(200);
    const { session, user } = signedInResponseSchema.parse(login.body);
    expect(user.name).toBe('Alice');
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const me = await t.http().get('/v1/auth/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(me.status).toBe(200);
    expect(userResponseSchema.parse(me.body)).toEqual(user);

    const refreshed = await t.http().post('/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    const renewed = signedInResponseSchema.parse(refreshed.body).session;

    const replay = await t.http().post('/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_SESSION');

    const logout = await t
      .http()
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${renewed.accessToken}`);
    expect(logout.status).toBe(204);

    const afterLogout = await t
      .http()
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${renewed.accessToken}`);
    expect(afterLogout.status).toBe(401);
  });

  it('exige un jeton valide sur toute route qui n’est pas publique', async () => {
    for (const authorization of [undefined, 'Bearer inconnu', 'Basic abc', 'Bearer']) {
      const call = t.http().get('/v1/objectives');
      const response = authorization ? await call.set('Authorization', authorization) : await call;

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it("répond 500, et non 401, quand le fournisseur d'identité est injoignable", async () => {
    const { authorization } = t.signIn('alice@apex.test');
    vi.spyOn(t.auth, 'whoAmI').mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:443'));

    const response = await t.http().get('/v1/auth/me').set('Authorization', authorization);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' },
    });
  });
});
