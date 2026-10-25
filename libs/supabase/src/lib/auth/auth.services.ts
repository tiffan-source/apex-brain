import { AuthProvider, AuthSession, Registration, User, UserAlreadyExistError } from '@org/auth';
import {
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  Session,
  User as SupabaseUser,
} from '@supabase/supabase-js';
import { SupabaseClientDataAccess } from '../supabase-client';
import { translateAuthError } from './auth-error.translator';

type Claims = {
  sub?: string;
  email?: string;
  role?: string;
  user_metadata?: Record<string, unknown>;
};

/**
 * Supabase Auth derrière le port `AuthProvider`, sans état (voir docs/adr/0003-authentification.md).
 */
export class SupabaseAuthServices implements AuthProvider {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  async register(email: string, password: string): Promise<Registration> {
    const { data, error } = await this.supabaseClient.createAuthClient().auth.signUp({ email, password });

    if (error) {
      throw translateAuthError(error, email);
    }

    if (!data.user) {
      throw new Error("Supabase n'a rendu aucun utilisateur à l'inscription");
    }

    // Avec la confirmation d'e-mail activée, une adresse déjà inscrite rend un utilisateur factice, sans identité.
    if (data.user.identities && data.user.identities.length === 0) {
      throw new UserAlreadyExistError(email);
    }

    const user = toUser(data.user);
    return { user, session: data.session ? toSession(data.session, user) : null };
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.supabaseClient
      .createAuthClient()
      .auth.signInWithPassword({ email, password });

    if (error) {
      throw translateAuthError(error, email);
    }

    return toSession(data.session, toUser(data.user));
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const { data, error } = await this.supabaseClient
      .createAuthClient()
      .auth.refreshSession({ refresh_token: refreshToken });

    if (error) {
      throw translateAuthError(error);
    }

    if (!data.session || !data.user) {
      throw translateAuthError({ message: 'No session returned', code: 'session_not_found' });
    }

    return toSession(data.session, toUser(data.user));
  }

  async logout(accessToken: string): Promise<void> {
    const { error } = await this.supabaseClient.clientInstance.auth.admin.signOut(accessToken, 'local');

    // Une session déjà fermée, ou un jeton qui ne vaut plus rien : il n'y a plus rien à fermer.
    if (error && !isClosedSessionError(error)) {
      throw translateAuthError(error);
    }
  }

  async whoAmI(accessToken: string): Promise<User | null> {
    const { data, error } = await this.supabaseClient.clientInstance.auth.getClaims(accessToken);

    if (error) {
      // Le serveur d'auth injoignable n'est pas un jeton invalide : on ne déconnecte personne pour une panne.
      if (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500) {
        throw new Error(`Supabase auth unavailable: ${error.message}`);
      }
      return null;
    }

    const claims = data?.claims as Claims | undefined;

    // Seul le jeton d'une personne connectée est accepté (une clé publique ou secrète n'est pas une personne).
    if (!claims?.sub || claims.role !== 'authenticated') {
      return null;
    }

    const user = new User(claims.sub, claims.email ?? '');
    const displayName = displayNameOf(claims.user_metadata);
    if (displayName) user.setDisplayName(displayName);
    return user;
  }
}

function isClosedSessionError(error: { status?: number; code?: string }): boolean {
  return (
    isAuthSessionMissingError(error) ||
    [401, 403, 404].includes(error.status ?? 0) ||
    error.code === 'session_not_found' ||
    error.code === 'bad_jwt'
  );
}

function displayNameOf(metadata: Record<string, unknown> | undefined): string | undefined {
  const candidate = metadata?.['display_name'] ?? metadata?.['full_name'] ?? metadata?.['name'];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function toUser(supabaseUser: SupabaseUser): User {
  const user = new User(supabaseUser.id, supabaseUser.email ?? '');
  user.setEmailVerified(Boolean(supabaseUser.email_confirmed_at));
  const displayName = displayNameOf(supabaseUser.user_metadata);
  if (displayName) user.setDisplayName(displayName);
  return user;
}

function toSession(session: Session, user: User): AuthSession {
  const expiresAtSeconds = session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in;

  return {
    user,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}
