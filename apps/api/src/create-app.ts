// Avant toute classe décorée : les métadonnées de type (`design:paramtypes`…) en dépendent.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ProductionAdaptersModule } from './adapters/production-adapters.module';
import { AppModule } from './app.module';
import type { Environment } from './config/environment';
import { configureApp } from './configure-app';

/**
 * L'application de production, configurée mais pas encore à l'écoute. Deux façons de la servir :
 * `main.ts` la fait écouter sur un port (serveur Node, développement), `serverless.ts` la confie à
 * une fonction Vercel qui lui passe les requêtes une à une.
 */
export async function createApp(environment: Environment): Promise<INestApplication> {
  const app = await NestFactory.create(
    AppModule.register({ environment, adapters: ProductionAdaptersModule.register(environment) }),
    {
      logger: new ConsoleLogger({ prefix: 'ApexBrain', json: environment.LOG_FORMAT === 'json' }),
    },
  );

  configureApp(app, environment);
  return app;
}
