import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnvironment } from './config/environment';
import { createApp } from './create-app';

type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;

/** L'application de cette instance : démarrée par sa première requête, réutilisée par les suivantes. */
let listener: Promise<RequestListener> | undefined;

async function start(): Promise<RequestListener> {
  const environment = loadEnvironment();

  if (environment.ASSISTANT_TURN_OWNERSHIP_SECONDS === 0) {
    // Sans propriété des tours, deux instances pourraient mener le même tour d'Akari (ADR 0009).
    throw new Error(
      'ASSISTANT_TURN_OWNERSHIP_SECONDS manque : une fonction Vercel le reçoit de son .vc-config.json ' +
        '(tools/vercel/build-output.mjs).',
    );
  }

  const app = (await createApp(environment)) as NestExpressApplication;
  await app.init();
  return app.getHttpAdapter().getInstance() as RequestListener;
}

/**
 * Le point d'entrée de la fonction Vercel (`tools/vercel/build-output.mjs`) : aucun port n'est
 * ouvert, Vercel passe chaque requête à Express. Une instance sert plusieurs requêtes, en même temps
 * ou l'une après l'autre (Fluid compute), et peut disparaître entre deux : rien de ce qui doit durer
 * ne vit en mémoire (l'état de l'assistant est dans Firestore, ADR 0009).
 */
export default async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  listener ??= start().catch((error: unknown) => {
    // Un démarrage raté (configuration invalide…) n'est pas gardé : la requête suivante réessaie.
    listener = undefined;
    throw error;
  });

  (await listener)(request, response);
}
