import { SupabaseAuthServices } from '../lib/auth/auth.services';
import {
  createIntegrationAccess,
  createTestUser,
  integrationConfig,
  integrationEnabled,
} from './supabase-test-environment';

describe.skipIf(!integrationEnabled)('Supabase — authentification (intégration)', () => {
  let auth: SupabaseAuthServices;

  beforeAll(() => {
    auth = new SupabaseAuthServices(createIntegrationAccess());
  });

  const freshEmail = () => `register-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@apex.test`;

  it('inscrit une personne, puis refuse la même adresse et un mot de passe trop court', async () => {
    const email = freshEmail();

    const registration = await auth.register(email, 'secret-123456');

    expect(registration.user.email).toBe(email);
    // Confirmation d'e-mail désactivée en local : la session est ouverte tout de suite.
    expect(registration.session?.accessToken).toEqual(expect.any(String));
    await expect(auth.register(email, 'secret-123456')).rejects.toMatchObject({ code: 'USER_ALREADY_EXIST' });
    await expect(auth.register(freshEmail(), '123')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  });

  it('connecte, reconnaît le jeton, le renouvelle et le révoque', async () => {
    const { id, email, password } = await createTestUser('login');

    await expect(auth.login(email, 'faux-mot-de-passe')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    const session = await auth.login(email, password);
    expect(session.user.uid).toBe(id);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(auth.whoAmI(session.accessToken)).resolves.toMatchObject({ uid: id, email });

    // Rotation : un nouveau jeton de renouvellement à chaque échange. (L'ancien reste accepté
    // quelques secondes, `refresh_token_reuse_interval`, pour les renouvellements concurrents.)
    const renewed = await auth.refresh(session.refreshToken);
    expect(renewed.refreshToken).not.toBe(session.refreshToken);
    await expect(auth.refresh('jeton-inconnu')).rejects.toMatchObject({ code: 'INVALID_SESSION' });

    await auth.logout(renewed.accessToken);
    await expect(auth.logout(renewed.accessToken)).resolves.toBeUndefined();
    await expect(auth.refresh(renewed.refreshToken)).rejects.toMatchObject({ code: 'INVALID_SESSION' });
  });

  it('lit les rôles dans app_metadata, à la connexion comme dans le jeton', async () => {
    const premium = await createTestUser('premium', { roles: ['premium', 'inconnu'] });

    const session = await auth.login(premium.email, premium.password);
    expect(session.user.roles).toEqual(['premium']);
    expect((await auth.whoAmI(session.accessToken))?.roles).toEqual(['premium']);
  });

  it('donne le rôle standard à toute inscription, dès son premier jeton', async () => {
    const registration = await auth.register(freshEmail(), 'secret-123456');
    const created = await createTestUser('sans-role');

    expect(registration.user.roles).toEqual(['standard']);
    expect((await auth.whoAmI(registration.session?.accessToken ?? ''))?.roles).toEqual(['standard']);
    const session = await auth.login(created.email, created.password);
    expect((await auth.whoAmI(session.accessToken))?.roles).toEqual(['standard']);
  });

  it("n'ajoute pas standard à un compte créé avec un rôle", async () => {
    const admin = await createTestUser('admin', { roles: ['admin'] });

    const session = await auth.login(admin.email, admin.password);

    expect((await auth.whoAmI(session.accessToken))?.roles).toEqual(['admin']);
  });

  it("ne reconnaît ni un jeton mal formé, ni une clé d'API", async () => {
    const { publishableKey, secretKey } = integrationConfig();

    await expect(auth.whoAmI('pas-un-jeton')).resolves.toBeNull();
    await expect(auth.whoAmI(publishableKey)).resolves.toBeNull();
    await expect(auth.whoAmI(secretKey)).resolves.toBeNull();
  });
});
