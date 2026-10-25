import type { INestApplication } from '@nestjs/common';
import type { SwaggerDocumentOptions } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { apiErrorSchema } from './schemas';

const isZodSchema = (schema: unknown): schema is z.ZodType =>
  (schema as { '~standard'?: { vendor?: string } })?.['~standard']?.vendor === 'zod';

/** Un schéma zod en schéma OpenAPI 3.0 (pour les réponses, que Nest ne lit pas d'elles-mêmes). */
export function openApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'output') {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
}

export const openApiErrorSchema = () => openApiSchema(apiErrorSchema);

/** Le document OpenAPI, construit depuis les mêmes schémas zod que la validation. */
export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Apex Brain')
    .setDescription(
      "L'API d'Apex : objectifs, étapes, pas, conversation et assistant. Les erreurs ont la forme " +
        '`{ error: { code, message } }` ; le `code` est le contrat, le `message` est technique.',
    )
    .setVersion('1')
    .addBearerAuth()
    .build();

  const options: SwaggerDocumentOptions = {
    standardSchemaConverter: (schema, { schemaType }) =>
      isZodSchema(schema) ? { schema: openApiSchema(schema, schemaType) } : undefined,
  };

  return SwaggerModule.createDocument(app, config, options);
}

export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, () => createOpenApiDocument(app), { jsonDocumentUrl: 'docs-json' });
}
