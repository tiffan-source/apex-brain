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

  it("ne reconnaît ni un jeton mal formé, ni une clé d'API", async () => {
    const { publishableKey, secretKey } = integrationConfig();

    await expect(auth.whoAmI('pas-un-jeton')).resolves.toBeNull();
    await expect(auth.whoAmI(publishableKey)).resolves.toBeNull();
    await expect(auth.whoAmI(secretKey)).resolves.toBeNull();
  });
});
