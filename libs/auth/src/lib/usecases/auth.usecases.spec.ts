import { InMemoryAuthProvider } from '../../testing';
import { CreateNewUserUseCase } from './create-new-user.usecase';
import { LogUserInUseCase } from './log-user-in.usecase';
import { RefreshSessionUseCase } from './refresh-session.usecase';
import { LogUserOutUseCase } from './log-user-out.usecase';
import { GetCurrentUserUseCase } from './get-current-user.usecase';

describe("Cas d'usage d'authentification", () => {
  const setup = (options: { requireEmailConfirmation?: boolean } = {}) => {
    const provider = new InMemoryAuthProvider(options);
    return {
      provider,
      register: new CreateNewUserUseCase(provider),
      login: new LogUserInUseCase(provider),
      refresh: new RefreshSessionUseCase(provider),
      logout: new LogUserOutUseCase(provider),
      me: new GetCurrentUserUseCase(provider),
    };
  };

  describe('CreateNewUserUseCase', () => {
    it('crée le compte et ouvre une session', async () => {
      const { register, me } = setup();

      const result = await register.execute({ email: 'alice@apex.test', password: 'secret123' });

      expect(result.success).toBe(true);
      if (!result.success || !result.data.session) throw new Error('session attendue');
      expect(result.data.user).toEqual({
        id: expect.any(String),
        name: 'alice@apex.test',
        email: 'alice@apex.test',
      });
      expect(result.data.session.expiresAt).toBeInstanceOf(Date);
      await expect(me.execute({ accessToken: result.data.session.accessToken })).resolves.toEqual({
        success: true,
        data: result.data.user,
      });
    });

    it("ne rend pas de session tant que l'e-mail n'est pas confirmé", async () => {
      const { register } = setup({ requireEmailConfirmation: true });

      const result = await register.execute({ email: 'alice@apex.test', password: 'secret123' });

      expect(result).toMatchObject({
        success: true,
        data: { session: null, user: { email: 'alice@apex.test' } },
      });
    });

    it('signale USER_ALREADY_EXIST et WEAK_PASSWORD', async () => {
      const { register } = setup();
      await register.execute({ email: 'alice@apex.test', password: 'secret123' });

      await expect(
        register.execute({ email: 'alice@apex.test', password: 'secret123' }),
      ).resolves.toMatchObject({
        success: false,
        error: { code: 'USER_ALREADY_EXIST' },
      });
      await expect(register.execute({ email: 'bob@apex.test', password: '123' })).resolves.toMatchObject({
        success: false,
        error: { code: 'WEAK_PASSWORD' },
      });
    });
  });

  describe('LogUserInUseCase', () => {
    it("ouvre une session avec le nom d'affichage de la personne", async () => {
      const { provider, login } = setup();
      provider.seedAccount('alice@apex.test', 'secret123', 'Alice');

      const result = await login.execute({ email: 'alice@apex.test', password: 'secret123' });

      expect(result).toMatchObject({
        success: true,
        data: { user: { name: 'Alice', email: 'alice@apex.test' } },
      });
    });

    it('signale INVALID_CREDENTIALS sans dire ce qui ne va pas', async () => {
      const { provider, login } = setup();
      provider.seedAccount('alice@apex.test', 'secret123');

      await expect(login.execute({ email: 'alice@apex.test', password: 'faux' })).resolves.toMatchObject({
        success: false,
        error: { code: 'INVALID_CREDENTIALS' },
      });
      await expect(
        login.execute({ email: 'inconnu@apex.test', password: 'secret123' }),
      ).resolves.toMatchObject({
        success: false,
        error: { code: 'INVALID_CREDENTIALS' },
      });
    });

    it('signale EMAIL_NOT_CONFIRMED', async () => {
      const { register, login } = setup({ requireEmailConfirmation: true });
      await register.execute({ email: 'alice@apex.test', password: 'secret123' });

      await expect(login.execute({ email: 'alice@apex.test', password: 'secret123' })).resolves.toMatchObject(
        {
          success: false,
          error: { code: 'EMAIL_NOT_CONFIRMED' },
        },
      );
    });
  });

  describe('RefreshSessionUseCase', () => {
    it("échange un jeton de renouvellement, qui ne sert qu'une fois", async () => {
      const { register, refresh } = setup();
      const registered = await register.execute({ email: 'alice@apex.test', password: 'secret123' });
      if (!registered.success || !registered.data.session) throw new Error('session attendue');
      const { refreshToken } = registered.data.session;

      const renewed = await refresh.execute({ refreshToken });
      expect(renewed).toMatchObject({ success: true, data: { user: { email: 'alice@apex.test' } } });

      await expect(refresh.execute({ refreshToken })).resolves.toMatchObject({
        success: false,
        error: { code: 'INVALID_SESSION' },
      });
    });
  });

  describe('LogUserOutUseCase et GetCurrentUserUseCase', () => {
    it('rend null pour un jeton fermé ou inconnu, et la déconnexion se répète sans erreur', async () => {
      const { provider, logout, me } = setup();
      const { accessToken } = provider.seedAccount('alice@apex.test', 'secret123');

      await expect(logout.execute({ accessToken })).resolves.toEqual({ success: true, data: undefined });
      await expect(logout.execute({ accessToken })).resolves.toEqual({ success: true, data: undefined });
      await expect(me.execute({ accessToken })).resolves.toEqual({ success: true, data: null });
      await expect(me.execute({ accessToken: 'n-importe-quoi' })).resolves.toEqual({
        success: true,
        data: null,
      });
    });
  });
});
