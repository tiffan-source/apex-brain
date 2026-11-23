import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InteractiveAIProvider } from '@org/ai';
import { ScriptedAIProvider } from '@org/ai/testing';
import { AkariRuleSource, AkariUsageJournal, Clock } from '@org/akari-access';
import {
  ControllableClock,
  InMemoryAkariRuleSource,
  InMemoryAkariUsageJournal,
} from '@org/akari-access/testing';
import type { ConversationMachine } from '@org/ai-assistant';
import { AuthProvider } from '@org/auth';
import { InMemoryAuthProvider } from '@org/auth/testing';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { createInMemoryChatInfrastructure } from '@org/chat/testing';
import { IdGenerator } from '@org/chore';
import { EventBus, InMemoryEventBus } from '@org/event-bus';
import { SequentialIdGenerator } from '@org/chore/testing';
import { ObjectiveRepository, TaskRepository } from '@org/objective';
import { GetObjectiveTreeQuery } from '@org/objective/bff';
import { createInMemoryObjectiveInfrastructure } from '@org/objective/testing';
import type { Role } from '@org/user';
import type { WorkflowRuntime } from '@org/workflow-runtime';
import { InMemoryWorkflowStateStore, WorkflowStateStore } from '@org/workflow-runtime';
import request from 'supertest';
import { PORTS } from '../../src/adapters/ports';
import { AppModule } from '../../src/app.module';
import { ASSISTANT_RUNTIME } from '../../src/assistant/assistant.module';
import type { Environment } from '../../src/config/environment';
import { loadEnvironment } from '../../src/config/environment';
import { configureApp } from '../../src/configure-app';
import { eventBusLogger } from '../../src/events/event-bus.logger';

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
 * L'application complète (modules, gardes, validation, filtre d'erreurs, configuration HTTP),
 * branchée sur des doublures en mémoire à la place de Supabase, Gemini et Firestore. `modules`
 * ajoute des modules propres à un test (des routes qui n'existent que pour lui).
 */
export async function createTestApp(
  environmentOverrides: Record<string, string> = {},
  options: { modules?: Type[] } = {},
) {
  const objectives = createInMemoryObjectiveInfrastructure();
  const chat = createInMemoryChatInfrastructure();
  const auth = new InMemoryAuthProvider();
  const ai = new ScriptedAIProvider();
  const workflowStates = new InMemoryWorkflowStateStore();
  const akariRules = new InMemoryAkariRuleSource();
  const akariJournal = new InMemoryAkariUsageJournal();
  const clock = new ControllableClock();
  const bus = new InMemoryEventBus(eventBusLogger);

  // Comme le trigger de la base : chaque objectif principal reçoit sa conversation.
  objectives.db.onObjectiveCreated((row) => {
    if (!row.parentId) chat.db.createConversation(row.id, row.ownerId);
  });
  // Comme la cascade de la base : la conversation disparaît avec son objectif.
  objectives.db.onObjectiveDeleted((row) => chat.db.deleteConversation(row.id));

  const adapters: DynamicModule = {
    module: InMemoryAdaptersModule,
    global: true,
    providers: [
      { provide: IdGenerator, useValue: new SequentialIdGenerator('id') },
      { provide: ObjectiveRepository, useValue: objectives.objectiveRepository },
      { provide: TaskRepository, useValue: objectives.taskRepository },
      { provide: GetObjectiveTreeQuery, useValue: objectives.getObjectiveTreeQuery },
      { provide: AuthProvider, useValue: auth },
      { provide: GetConversationsQuery, useValue: chat.getConversationsQuery },
      { provide: AddMessageCommand, useValue: chat.addMessageCommand },
      { provide: InteractiveAIProvider, useValue: ai },
      { provide: WorkflowStateStore, useValue: workflowStates },
      { provide: AkariRuleSource, useValue: akariRules },
      { provide: AkariUsageJournal, useValue: akariJournal },
      { provide: Clock, useValue: clock },
      { provide: EventBus, useValue: bus },
    ],
    exports: [...PORTS],
  };

  const environment: Environment = loadEnvironment({ ...TEST_ENVIRONMENT, ...environmentOverrides });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ environment, adapters }), ...(options.modules ?? [])],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  configureApp(app, environment);
  await app.init();

  const http = () => request(app.getHttpServer());

  /**
   * Attendre que l'assistant ait sauvegardé et publié ses transitions, et que les abonnés du bus aient
   * réagi : le comptage d'un tour réussi suit sa fin d'une fraction de seconde (docs/adr/0010).
   */
  const settle = async () => {
    await app.get<WorkflowRuntime<ConversationMachine>>(ASSISTANT_RUNTIME).idle();
    await bus.idle();
  };

  /**
   * Créer une personne et rendre de quoi appeler l'API en son nom. Sans `roles`, elle a `standard`
   * comme tout nouveau compte ; `[]` donne un compte sans rôle.
   */
  const signIn = (email: string, roles?: readonly Role[]) => {
    const { id, accessToken } = auth.seedAccount(email, 'secret123', { roles });
    // Le trigger de la base ne crée jamais de compte sans rôle : on les lui retire ensuite.
    if (roles?.length === 0) auth.setRoles(email, []);
    return { id, accessToken, authorization: `Bearer ${accessToken}` };
  };

  return {
    app,
    http,
    signIn,
    objectives,
    chat,
    auth,
    ai,
    workflowStates,
    akariRules,
    akariJournal,
    clock,
    bus,
    settle,
    close: () => app.close(),
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
