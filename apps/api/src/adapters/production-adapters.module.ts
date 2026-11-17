import type { DynamicModule, Provider } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { InteractiveAIProvider } from '@org/ai';
import { IWorkflowStateRepository, InMemoryWorkflowStateRepository } from '@org/ai-assistant';
import { AuthProvider } from '@org/auth';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { IdGenerator, UuidIdGenerator } from '@org/chore';
import {
  FirebaseClientDataAccess,
  FirebaseWorkflowStateRepository,
  FirestoreUsageLedger,
} from '@org/firebase';
import { createGeminiInteractionsClient, GeminiInteractiveAIProvider } from '@org/gemini';
import { ObjectiveRepository, TaskRepository } from '@org/objective';
import { GetObjectiveTreeQuery } from '@org/objective/bff';
import {
  SupabaseAddMessageCommand,
  SupabaseAuthServices,
  SupabaseClientDataAccess,
  SupabaseGetAllMessagesQuery,
  SupabaseGetObjectiveTreeQuery,
  SupabaseObjectiveRepository,
  SupabaseTaskRepository,
  SupabaseUsagePolicySource,
} from '@org/supabase';
import { InMemoryUsageLedger, UsageLedger, UsagePolicySource } from '@org/usage';
import type { Environment } from '../config/environment';
import { PORTS } from './ports';

@Module({})
export class ProductionAdaptersModule {
  /** Les ports branchés sur Supabase, Gemini et Firestore, d'après la configuration. */
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

    // Firestore : l'état des workflows et les compteurs d'usage. Le client réutilise l'app Firebase déjà ouverte.
    const firebase = () =>
      new FirebaseClientDataAccess({
        projectId: environment.FIREBASE_PROJECT_ID as string,
        clientEmail: environment.FIREBASE_CLIENT_EMAIL,
        privateKey: environment.FIREBASE_PRIVATE_KEY,
        databaseId: environment.FIREBASE_DATABASE_ID,
      });

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
          provide: IWorkflowStateRepository,
          useFactory: () =>
            environment.WORKFLOW_STATE_STORE === 'memory'
              ? new InMemoryWorkflowStateRepository()
              : new FirebaseWorkflowStateRepository(firebase()),
        },
        // Les politiques d'usage vivent dans Supabase, leurs compteurs hors de la base métier.
        fromSupabase(UsagePolicySource, (client) => new SupabaseUsagePolicySource(client)),
        {
          provide: UsageLedger,
          useFactory: () =>
            environment.WORKFLOW_STATE_STORE === 'memory'
              ? new InMemoryUsageLedger()
              : new FirestoreUsageLedger(firebase()),
        },
      ],
      exports: [...PORTS],
    };
  }
}
