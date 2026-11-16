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

    /** L'IA de l'assistant : seule la clé du fournisseur choisi est requise. */
    AI_PROVIDER: z.enum(['gemini', 'claude']).default('gemini'),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).default('gemini-3.8-flash'),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    CLAUDE_MODEL: z.string().min(1).default('claude-sonnet-5-5'),

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
  .superRefine(
    (environment, context) => {
      const requireVariable = (
        name: 'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY' | 'FIREBASE_PROJECT_ID',
        condition: string,
      ) => {
        if (!environment[name]) {
          context.addIssue({ code: 'custom', path: [name], message: `requis quand ${condition}` });
        }
      };

      if (environment.AI_PROVIDER === 'gemini') requireVariable('GEMINI_API_KEY', 'AI_PROVIDER=gemini');
      if (environment.AI_PROVIDER === 'claude') requireVariable('ANTHROPIC_API_KEY', 'AI_PROVIDER=claude');
      if (environment.WORKFLOW_STATE_STORE === 'firestore') {
        requireVariable('FIREBASE_PROJECT_ID', 'WORKFLOW_STATE_STORE=firestore');
      }
    },
    // Vérifié même quand d'autres variables sont invalides, pour dire tout ce qui manque en une fois :
    // ces comparaisons à des valeurs exactes ne se trompent pas sur une configuration à moitié lue.
    { when: () => true },
  );

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
