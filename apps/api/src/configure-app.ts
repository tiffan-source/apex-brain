import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Environment } from './config/environment';
import { setupOpenApi } from './http/openapi';

/**
 * La configuration HTTP de l'application, partagée par le démarrage et les tests e2e : ce que les
 * tests vérifient est ce qui tourne en production.
 */
export function configureApp(app: INestApplication, environment: Environment): void {
  const express = app as NestExpressApplication;

  // Derrière un proxy, l'adresse IP réelle (limitation de débit des routes publiques).
  express.set('trust proxy', environment.TRUST_PROXY);
  express.disable('x-powered-by');

  app.use(
    helmet({
      // La page /docs (Swagger UI) charge ses scripts et styles depuis l'API elle-même.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );

  app.enableCors({
    origin: environment.CORS_ORIGINS.length > 0 ? environment.CORS_ORIGINS : false,
    credentials: false,
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Toutes les routes sous /v1 (sauf /health) : une version 2 pourra coexister avec les clients existants.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableShutdownHooks();

  if (environment.SWAGGER_ENABLED) {
    setupOpenApi(app);
  }
}
