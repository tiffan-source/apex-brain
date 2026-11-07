import type { INestApplication } from '@nestjs/common';
import type { SwaggerDocumentOptions } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { apiErrorSchema } from './schemas';

const isZodSchema = (schema: unknown): schema is z.ZodType =>
  (schema as { '~standard'?: { vendor?: string } })?.['~standard']?.vendor === 'zod';

/**
 * Les schémas nommés (`.meta({ id })`, nécessaires aux schémas récursifs comme l'arbre d'objectifs),
 * rangés dans `components.schemas` du document : une référence en ligne ne se résoudrait pas.
 */
const namedSchemas: Record<string, unknown> = {};

/** Un schéma zod en schéma OpenAPI 3.0 (pour les réponses, que Nest ne lit pas d'elles-mêmes). */
export function openApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'output') {
  const converted = z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  const { definitions, ...rest } = JSON.parse(
    JSON.stringify(converted).replaceAll('"#/definitions/', '"#/components/schemas/'),
  ) as Record<string, unknown> & { definitions?: Record<string, unknown> };

  Object.assign(namedSchemas, definitions);
  return rest;
}

export const openApiErrorSchema = () => openApiSchema(apiErrorSchema);

/** Le document OpenAPI, construit depuis les mêmes schémas zod que la validation. */
export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Apex Brain')
    .setDescription(
      "L'API d'Apex : objectifs, étapes, pas, conversation et assistant. Les erreurs ont la forme " +
        '`{ error: { code, message } }` ; le `code` est le contrat, le `message` est technique. ' +
        'La v2 sépare les commandes (un geste nommé chacune) des lectures pour les clients (tag `bff`).',
    )
    .setVersion('2')
    .addBearerAuth()
    .build();

  const options: SwaggerDocumentOptions = {
    standardSchemaConverter: (schema, { schemaType }) =>
      isZodSchema(schema) ? { schema: openApiSchema(schema, schemaType) } : undefined,
  };

  const document = SwaggerModule.createDocument(app, config, options);
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ...(namedSchemas as Record<string, object>) },
  };
  return document;
}

export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, () => createOpenApiDocument(app), { jsonDocumentUrl: 'docs-json' });
}
