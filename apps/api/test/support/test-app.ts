import type { DynamicModule, INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InteractiveAIProvider } from '@org/ai';
import { ScriptedAIProvider } from '@org/ai/testing';
import { InMemoryWorkflowStateRepository, IWorkflowStateRepository } from '@org/ai-assistant';
import { AuthProvider } from '@org/auth';
import { InMemoryAuthProvider } from '@org/auth/testing';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { createInMemoryChatInfrastructure } from '@org/chat/testing';
import { IdGenerator } from '@org/chore';
import { SequentialIdGenerator } from '@org/chore/testing';
import { GetAllObjectiveAndTaskQuery, ObjectiveRepository, TaskRepository } from '@org/objective';
import { createInMemoryObjectiveInfrastructure } from '@org/objective/testing';
import request from 'supertest';
import { PORTS } from '../../src/adapters/ports';
import { AppModule } from '../../src/app.module';
import type { Environment } from '../../src/config/environment';
import { loadEnvironment } from '../../src/config/environment';
import { configureApp } from '../../src/configure-app';

export const TEST_ENVIRONMENT = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_PUBLISHABLE_KEY: 'publishable',
  SUPABASE_SECRET_KEY: 'secret',
  GEMINI_API_KEY: 'gemini',
  WORKFLOW_STATE_STORE: 'memory',
  CORS_ORIGINS: 'http://localhost:4200',
  // Assez haut pour que les tests ne butent pas sur la limitation de débit (testée à part).
  THROTTLE_DEFAULT_LIMIT: '10000',
  THROTTLE_AUTH_LIMIT: '10000',
  THROTTLE_ASSISTANT_MESSAGE_LIMIT: '10000',
};

@Module({})
class InMemoryAdaptersModule {}

/**
 * L'application complète (modules, garde, validation, filtre d'erreurs, configuration HTTP),
 * branchée sur des doublures en mémoire à la place de Supabase, Gemini et Firestore.
 */
export async function createTestApp(environmentOverrides: Record<string, string> = {}) {
  const objectives = createInMemoryObjectiveInfrastructure();
  const chat = createInMemoryChatInfrastructure();
  const auth = new InMemoryAuthProvider();
  const ai = new ScriptedAIProvider();
  const workflowStates = new InMemoryWorkflowStateRepository();

  // Comme le trigger de la base : chaque objectif principal reçoit sa conversation.
  objectives.db.onObjectiveCreated((row) => {
    if (!row.parentId) chat.db.createConversation(row.id, row.ownerId);
  });

  const adapters: DynamicModule = {
    module: InMemoryAdaptersModule,
    global: true,
    providers: [
      { provide: IdGenerator, useValue: new SequentialIdGenerator('id') },
      { provide: ObjectiveRepository, useValue: objectives.objectiveRepository },
      { provide: TaskRepository, useValue: objectives.taskRepository },
      { provide: GetAllObjectiveAndTaskQuery, useValue: objectives.getAllObjectiveAndTaskQuery },
      { provide: AuthProvider, useValue: auth },
      { provide: GetConversationsQuery, useValue: chat.getConversationsQuery },
      { provide: AddMessageCommand, useValue: chat.addMessageCommand },
      { provide: InteractiveAIProvider, useValue: ai },
      { provide: IWorkflowStateRepository, useValue: workflowStates },
    ],
    exports: [...PORTS],
  };

  const environment: Environment = loadEnvironment({ ...TEST_ENVIRONMENT, ...environmentOverrides });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ environment, adapters })],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  configureApp(app, environment);
  await app.init();

  const http = () => request(app.getHttpServer());

  /** Créer une personne et rendre de quoi appeler l'API en son nom. */
  const signIn = (email: string) => {
    const { id, accessToken } = auth.seedAccount(email, 'secret123');
    return { id, accessToken, authorization: `Bearer ${accessToken}` };
  };

  return { app, http, signIn, objectives, chat, auth, ai, workflowStates, close: () => app.close() };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
