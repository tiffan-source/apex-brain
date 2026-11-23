import { InvalidEnvironmentError, loadEnvironment } from './environment';

const minimal = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'publishable',
  SUPABASE_SECRET_KEY: 'secret',
  GEMINI_API_KEY: 'gemini',
  FIREBASE_PROJECT_ID: 'apex',
};

describe('loadEnvironment', () => {
  it('applique les valeurs par défaut', () => {
    expect(loadEnvironment(minimal)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGINS: [],
      TRUST_PROXY: false,
      SWAGGER_ENABLED: true,
      GEMINI_MODEL: 'gemini-3.8-flash',
      WORKFLOW_STATE_STORE: 'firestore',
      ASSISTANT_IDLE_TIMEOUT_MINUTES: 30,
      EVENT_BUS: 'memory',
      EVENT_BUS_CHANNEL: 'apex-brain:events',
    });
  });

  it('lit les listes, les booléens et les nombres', () => {
    expect(
      loadEnvironment({
        ...minimal,
        PORT: '8080',
        CORS_ORIGINS: 'http://localhost:4200, https://apex.app',
        TRUST_PROXY: 'true',
        SWAGGER_ENABLED: '0',
      }),
    ).toMatchObject({
      PORT: 8080,
      CORS_ORIGINS: ['http://localhost:4200', 'https://apex.app'],
      TRUST_PROXY: true,
      SWAGGER_ENABLED: false,
    });
  });

  it('dit tout ce qui manque, en une fois', () => {
    expect(() => loadEnvironment({ SUPABASE_URL: 'pas une url', GEMINI_API_KEY: '' })).toThrow(
      InvalidEnvironmentError,
    );

    try {
      loadEnvironment({ SUPABASE_URL: 'pas une url' });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('SUPABASE_URL');
      expect(message).toContain('SUPABASE_SECRET_KEY');
      expect(message).toContain('GEMINI_API_KEY');
    }
  });

  it("exige le projet Firebase quand l'état des workflows va dans Firestore", () => {
    const { FIREBASE_PROJECT_ID: _, ...withoutFirebase } = minimal;

    expect(() => loadEnvironment(withoutFirebase)).toThrow(/FIREBASE_PROJECT_ID/);
  });

  it("n'exige pas Firebase quand l'état des workflows reste en mémoire", () => {
    const { FIREBASE_PROJECT_ID: _unused, ...withoutFirebase } = minimal;

    expect(loadEnvironment({ ...withoutFirebase, WORKFLOW_STATE_STORE: 'memory' }).WORKFLOW_STATE_STORE).toBe(
      'memory',
    );
  });

  it('exige l’adresse de Redis quand le bus passe par Redis', () => {
    expect(() => loadEnvironment({ ...minimal, EVENT_BUS: 'redis' })).toThrow(/REDIS_URL/);
    expect(() => loadEnvironment({ ...minimal, EVENT_BUS: 'redis', REDIS_URL: 'pas une url' })).toThrow(
      /REDIS_URL/,
    );
  });

  it('accepte une adresse Redis, chiffrée ou non', () => {
    for (const url of ['redis://127.0.0.1:6379', 'rediss://default:secret@redis.example.com:6380']) {
      expect(loadEnvironment({ ...minimal, EVENT_BUS: 'redis', REDIS_URL: url })).toMatchObject({
        EVENT_BUS: 'redis',
        REDIS_URL: url,
      });
    }
  });
});
