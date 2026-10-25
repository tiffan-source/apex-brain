import { translateAuthError } from './auth-error.translator';

describe('translateAuthError', () => {
  it.each([
    [{ message: 'User already registered', code: 'user_already_exists', status: 422 }, 'USER_ALREADY_EXIST'],
    [{ message: 'User already registered', status: 400 }, 'USER_ALREADY_EXIST'],
    [
      { message: 'Password should be at least 6 characters', code: 'weak_password', status: 422 },
      'WEAK_PASSWORD',
    ],
    [{ message: 'Email address is invalid', code: 'email_address_invalid', status: 400 }, 'INVALID_EMAIL'],
    [
      { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
      'INVALID_CREDENTIALS',
    ],
    [{ message: 'Invalid login credentials', status: 400 }, 'INVALID_CREDENTIALS'],
    [{ message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 }, 'EMAIL_NOT_CONFIRMED'],
    [
      { message: 'Invalid Refresh Token: Already Used', code: 'refresh_token_already_used', status: 400 },
      'INVALID_SESSION',
    ],
    [{ message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 }, 'INVALID_SESSION'],
    [
      { message: 'Request rate limit reached', code: 'over_request_rate_limit', status: 429 },
      'TOO_MANY_REQUESTS',
    ],
  ])('traduit %j en %s', (error, code) => {
    expect(translateAuthError(error, 'alice@apex.test')).toMatchObject({ code });
  });

  it("laisse technique une erreur qu'il ne reconnaît pas", () => {
    const translated = translateAuthError({
      message: 'Database error saving new user',
      code: 'unexpected_failure',
      status: 500,
    });

    expect(translated).not.toHaveProperty('code');
    expect(translated.message).toContain('unexpected_failure');
  });

  it('garde les raisons du refus du mot de passe', () => {
    expect(
      translateAuthError({ message: 'weak', code: 'weak_password', reasons: ['length', 'characters'] }),
    ).toMatchObject({ code: 'WEAK_PASSWORD', metadata: { reasons: ['length', 'characters'] } });
  });
});
