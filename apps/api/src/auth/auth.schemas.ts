import { z } from 'zod';
import { dateOutputSchema } from '../http/schemas';

export const credentialsSchema = z.object({
  // Nettoyée avant d'être vérifiée : « Alice@Apex.test » et « alice@apex.test » sont la même adresse.
  email: z.string().trim().toLowerCase().pipe(z.email()).meta({ format: 'email' }),
  // La politique de mot de passe est celle de Supabase (WEAK_PASSWORD) ; ici, seulement des bornes.
  password: z.string().min(1).max(256),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshBody = z.infer<typeof refreshSchema>;

export const userResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: dateOutputSchema,
});

export const signedInResponseSchema = z.object({
  user: userResponseSchema,
  session: sessionResponseSchema,
});

export const registeredResponseSchema = z.object({
  user: userResponseSchema,
  /** `null` tant que l'adresse e-mail doit être confirmée. */
  session: sessionResponseSchema.nullable(),
});
