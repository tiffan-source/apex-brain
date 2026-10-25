import { StandardSchemaValidationPipe } from '@nestjs/common';
import { RequestValidationException } from './api-error';

/**
 * Valider chaque paramètre qui porte un schéma (`@Body({ schema })`, `@Param('id', { schema })`…)
 * et rendre la valeur transformée par le schéma (dates, chaînes nettoyées…).
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    transform: true,
    exceptionFactory: (issues) =>
      new RequestValidationException(
        issues.map((issue) => ({
          path: (issue.path ?? [])
            .map((segment) => String(typeof segment === 'object' && segment !== null ? segment.key : segment))
            .join('.'),
          message: issue.message,
        })),
      ),
  });
}
