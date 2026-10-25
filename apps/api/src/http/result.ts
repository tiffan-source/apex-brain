import type { Result } from '@org/chore';
import { DomainFailureException } from './api-error';

/** Les données d'un résultat réussi ; un échec devient une réponse d'erreur. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.success) {
    throw new DomainFailureException(result.error);
  }
  return result.data;
}
