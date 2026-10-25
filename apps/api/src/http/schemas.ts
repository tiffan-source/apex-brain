import { z } from 'zod';

/** Un identifiant dans l'URL. */
export const idSchema = z.string().trim().min(1).max(200);

/** Un texte court obligatoire (titres). */
export const titleSchema = z.string().trim().min(1).max(200);

/** Un texte long facultatif (description, pourquoi). */
export const longTextSchema = z.string().trim().max(5000);

/** Importance ou urgence d'un pas, de 1 à 5 (à partir de 3 : important, urgent). */
export const levelSchema = z.number().int().min(1).max(5);

/** Une date (`2027-04-01`) ou un instant ISO 8601 (`2027-04-01T08:00:00.000Z`), lu en `Date`. */
export const dateInputSchema = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((value) => new Date(value));

/** Un instant renvoyé par l'API : ISO 8601. */
export const dateOutputSchema = z.iso.datetime();

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
