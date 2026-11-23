import type { DynamicModule, OnApplicationShutdown, Provider } from '@nestjs/common';
import { Inject, Module } from '@nestjs/common';
import { InteractiveAIProvider } from '@org/ai';
import {
  AkariRuleSource,
  AkariUsageJournal,
  Clock,
  InMemoryAkariRuleSource,
  InMemoryAkariUsageJournal,
  SystemClock,
} from '@org/akari-access';
import { AuthProvider } from '@org/auth';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { IdGenerator, UuidIdGenerator } from '@org/chore';
import { EventBus, InMemoryEventBus } from '@org/event-bus';
import { FirebaseClientDataAccess, FirebaseWorkflowStateStore } from '@org/firebase';
import { createGeminiInteractionsClient, GeminiInteractiveAIProvider } from '@org/gemini';
import { ObjectiveRepository, TaskRepository } from '@org/objective';
import { GetObjectiveTreeQuery } from '@org/objective/bff';
import { RedisEventBus } from '@org/redis';
import {
  SupabaseAddMessageCommand,
  SupabaseAuthServices,
  SupabaseClientDataAccess,
  SupabaseGetAllMessagesQuery,
  SupabaseGetObjectiveTreeQuery,
  SupabaseObjectiveRepository,
  SupabaseTaskRepository,
} from '@org/supabase';
import { InMemoryWorkflowStateStore, WorkflowStateStore } from '@org/workflow-runtime';
import type { Environment } from '../config/environment';
import { eventBusLogger } from '../events/event-bus.logger';
import { PORTS } from './ports';

@Module({})
export class ProductionAdaptersModule implements OnApplicationShutdown {
  constructor(@Inject(EventBus) private readonly bus: EventBus) {}

  /**
   * Fermer le bus en dernier : module global, ses crochets d'arrêt passent après ceux des modules qui
   * l'utilisent (le runtime de l'assistant a publié ses derniers événements, les abonnés les traitent).
   */
  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }

  /** Les ports branchés sur Supabase, Gemini, Firestore et Redis, d'après la configuration. */
  static register(environment: Environment): DynamicModule {
    const supabase: Provider = {
      provide: SupabaseClientDataAccess,
      useFactory: () =>
        new SupabaseClientDataAccess({
          url: environment.SUPABASE_URL,
          publishableKey: environment.SUPABASE_PUBLISHABLE_KEY,
          secretKey: environment.SUPABASE_SECRET_KEY,
        }),
    };

    const fromSupabase = <T>(
      provide: abstract new (...args: never[]) => T,
      build: (client: SupabaseClientDataAccess) => T,
    ): Provider => ({
      provide,
      useFactory: build,
      inject: [SupabaseClientDataAccess],
    });

    return {
      module: ProductionAdaptersModule,
      global: true,
      providers: [
        supabase,
        { provide: IdGenerator, useFactory: () => new UuidIdGenerator() },
        fromSupabase(ObjectiveRepository, (client) => new SupabaseObjectiveRepository(client)),
        fromSupabase(TaskRepository, (client) => new SupabaseTaskRepository(client)),
        fromSupabase(GetObjectiveTreeQuery, (client) => new SupabaseGetObjectiveTreeQuery(client)),
        fromSupabase(AuthProvider, (client) => new SupabaseAuthServices(client)),
        fromSupabase(GetConversationsQuery, (client) => new SupabaseGetAllMessagesQuery(client)),
        fromSupabase(AddMessageCommand, (client) => new SupabaseAddMessageCommand(client)),
        {
          provide: InteractiveAIProvider,
          useFactory: () =>
            new GeminiInteractiveAIProvider(createGeminiInteractionsClient(environment.GEMINI_API_KEY), {
              model: environment.GEMINI_MODEL,
            }),
        },
        {
          provide: WorkflowStateStore,
          useFactory: () =>
            environment.WORKFLOW_STATE_STORE === 'memory'
              ? new InMemoryWorkflowStateStore()
              : new FirebaseWorkflowStateStore(
                  new FirebaseClientDataAccess({
                    projectId: environment.FIREBASE_PROJECT_ID as string,
                    clientEmail: environment.FIREBASE_CLIENT_EMAIL,
                    privateKey: environment.FIREBASE_PRIVATE_KEY,
                    databaseId: environment.FIREBASE_DATABASE_ID,
                  }),
                ),
        },
        {
          // En mémoire pour une seule instance de l'API, Redis dès qu'il y en a plusieurs (docs/adr/0010).
          // Redis injoignable au démarrage : le serveur ne démarre pas.
          provide: EventBus,
          useFactory: (): Promise<EventBus> | EventBus =>
            environment.EVENT_BUS === 'redis'
              ? RedisEventBus.connect({
                  url: environment.REDIS_URL as string,
                  channel: environment.EVENT_BUS_CHANNEL,
                  logger: eventBusLogger,
                })
              : new InMemoryEventBus(eventBusLogger),
        },
        { provide: Clock, useFactory: () => new SystemClock() },
        // En mémoire jusqu'aux adaptateurs Firestore (issue #13) : le journal est perdu au redémarrage.
        { provide: AkariRuleSource, useFactory: () => new InMemoryAkariRuleSource() },
        { provide: AkariUsageJournal, useFactory: () => new InMemoryAkariUsageJournal() },
      ],
      exports: [...PORTS],
    };
  }
}
