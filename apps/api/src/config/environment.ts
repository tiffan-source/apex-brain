import { z } from 'zod';

const commaSeparated = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

/**
 * La configuration du serveur, lue dans les variables d'environnement et validée au démarrage :
 * une variable manquante ou mal formée arrête le serveur avec un message clair, plutôt qu'une
 * panne plus tard, à la première requête qui en a besoin.
 */
export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    CORS_ORIGINS: commaSeparated,
    TRUST_PROXY: z.stringbool().default(false),
    SWAGGER_ENABLED: z.stringbool().default(true),
    LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),

    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SUPABASE_SECRET_KEY: z.string().min(1),

    GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().min(1).default('gemini-3.8-flash'),

    WORKFLOW_STATE_STORE: z.enum(['firestore', 'memory']).default('firestore'),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    FIREBASE_DATABASE_ID: z.string().optional(),

    ASSISTANT_IDLE_TIMEOUT_MINUTES: z.coerce.number().positive().default(30),

    THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().positive().default(300),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
    THROTTLE_ASSISTANT_MESSAGE_LIMIT: z.coerce.number().int().positive().default(20),
  })
  .superRefine((environment, context) => {
    if (environment.WORKFLOW_STATE_STORE === 'firestore' && !environment.FIREBASE_PROJECT_ID) {
      context.addIssue({
        code: 'custom',
        path: ['FIREBASE_PROJECT_ID'],
        message: 'requis quand WORKFLOW_STATE_STORE=firestore',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(issues: string[]) {
    super(`Configuration invalide :\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/** Lire et valider la configuration (par défaut, `process.env`). */
export function loadEnvironment(source: Record<string, string | undefined> = process.env): Environment {
  // Une variable vide vaut une variable absente : les valeurs par défaut s'appliquent.
  const defined = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = environmentSchema.safeParse(defined);

  if (!parsed.success) {
    throw new InvalidEnvironmentError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`),
    );
  }

  return parsed.data;
}

/** Le jeton d'injection de la configuration validée. */
export const APP_ENVIRONMENT = Symbol('APP_ENVIRONMENT');
