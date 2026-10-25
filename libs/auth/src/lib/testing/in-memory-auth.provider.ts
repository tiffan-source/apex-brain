import { AuthSession } from '../models/auth-session';
import { User } from '../models/user';
import { AuthProvider, Registration } from '../protocols/auth.provider';
import { UserAlreadyExistError } from '../errors/user-already-exist.error';
import { WeakPasswordError } from '../errors/weak-password.error';
import { InvalidCredentialsError } from '../errors/invalid-credentials.error';
import { EmailNotConfirmedError } from '../errors/email-not-confirmed.error';
import { InvalidSessionError } from '../errors/invalid-session.error';

type Account = { id: string; email: string; password: string; displayName?: string; confirmed: boolean };

/**
 * Un fournisseur d'identité en mémoire, avec les règles de Supabase utiles aux tests :
 * mot de passe de 6 caractères minimum, jetons de renouvellement à usage unique, déconnexion
 * qui invalide les jetons, confirmation d'e-mail activable.
 */
export class InMemoryAuthProvider extends AuthProvider {
  readonly accounts = new Map<string, Account>();
  private readonly accessTokens = new Map<string, string>();
  private readonly refreshTokens = new Map<string, string>();
  private counter = 0;

  constructor(
    private readonly options: { requireEmailConfirmation?: boolean; sessionLifetimeMs?: number } = {},
  ) {
    super();
  }

  /** Créer un compte directement (avec un nom d'affichage, si besoin) et rendre son jeton d'accès. */
  seedAccount(email: string, password: string, displayName?: string): { id: string; accessToken: string } {
    const id = this.nextId('user');
    this.accounts.set(email, { id, email, password, displayName, confirmed: true });
    return { id, accessToken: this.openSession(this.accounts.get(email) as Account).accessToken };
  }

  async register(email: string, password: string): Promise<Registration> {
    if (this.accounts.has(email)) throw new UserAlreadyExistError(email);
    if (password.length < 6) throw new WeakPasswordError(['length']);

    const confirmed = !this.options.requireEmailConfirmation;
    const account: Account = { id: this.nextId('user'), email, password, confirmed };
    this.accounts.set(email, account);

    return { user: this.toUser(account), session: confirmed ? this.openSession(account) : null };
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const account = this.accounts.get(email);
    if (!account || account.password !== password) throw new InvalidCredentialsError();
    if (!account.confirmed) throw new EmailNotConfirmedError();
    return this.openSession(account);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const accountId = this.refreshTokens.get(refreshToken);
    const account = [...this.accounts.values()].find((candidate) => candidate.id === accountId);
    if (!account) throw new InvalidSessionError();

    this.refreshTokens.delete(refreshToken);
    return this.openSession(account);
  }

  async logout(accessToken: string): Promise<void> {
    const accountId = this.accessTokens.get(accessToken);
    if (!accountId) return;

    for (const [token, owner] of [...this.accessTokens])
      if (owner === accountId) this.accessTokens.delete(token);
    for (const [token, owner] of [...this.refreshTokens])
      if (owner === accountId) this.refreshTokens.delete(token);
  }

  async whoAmI(accessToken: string): Promise<User | null> {
    const accountId = this.accessTokens.get(accessToken);
    const account = [...this.accounts.values()].find((candidate) => candidate.id === accountId);
    return account ? this.toUser(account) : null;
  }

  private openSession(account: Account): AuthSession {
    const accessToken = this.nextId('access');
    const refreshToken = this.nextId('refresh');
    this.accessTokens.set(accessToken, account.id);
    this.refreshTokens.set(refreshToken, account.id);
    return {
      user: this.toUser(account),
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + (this.options.sessionLifetimeMs ?? 3_600_000)),
    };
  }

  private toUser(account: Account): User {
    const user = new User(account.id, account.email);
    user.setEmailVerified(account.confirmed);
    if (account.displayName) user.setDisplayName(account.displayName);
    return user;
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }
}
