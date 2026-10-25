import { z } from 'zod';
import { dateOutputSchema } from '../http/schemas';

export const conversationResponseSchema = z.object({
  id: z.string(),
  /** Dans l'ordre chronologique. `sender` vaut l'id de la personne, ou `AI` pour l'assistant. */
  messages: z.array(
    z.object({
      id: z.string(),
      sender: z.string(),
      content: z.string(),
      createdAt: dateOutputSchema,
    }),
  ),
});
