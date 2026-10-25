import {
  AuthRateLimitedError,
  EmailNotConfirmedError,
  InvalidCredentialsError,
  InvalidEmailError,
  InvalidSessionError,
  UserAlreadyExistError,
  WeakPasswordError,
} from '@org/auth';

/** Ce que les erreurs de `supabase-js` (AuthError) exposent et qui nous sert. */
export type SupabaseAuthErrorLike = {
  message: string;
  status?: number;
  code?: string;
  reasons?: string[];
};

const INVALID_SESSION_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'bad_jwt',
]);

/**
 * Traduire une erreur de Supabase Auth en erreur du domaine `auth`, d'après son code stable
 * (`error.code`), avec un repli sur les messages des versions de GoTrue qui n'en ont pas.
 * Une erreur non reconnue reste technique (elle deviendra `UNKNOWN_ERROR`).
 */
export function translateAuthError(error: SupabaseAuthErrorLike, email = ''): Error {
  const code = error.code ?? '';

  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    /already registered/i.test(error.message)
  ) {
    return new UserAlreadyExistError(email);
  }
  if (code === 'weak_password') {
    return new WeakPasswordError(error.reasons ?? []);
  }
  if (code === 'email_address_invalid' || code === 'email_address_not_authorized') {
    return new InvalidEmailError(email);
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) {
    return new InvalidCredentialsError();
  }
  if (code === 'email_not_confirmed') {
    return new EmailNotConfirmedError();
  }
  if (INVALID_SESSION_CODES.has(code) || /refresh token/i.test(error.message)) {
    return new InvalidSessionError();
  }
  if (code.startsWith('over_') || error.status === 429) {
    return new AuthRateLimitedError();
  }

  return new Error(`Supabase auth error${code ? ` (${code})` : ''}: ${error.message}`);
}
