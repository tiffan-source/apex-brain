import type { DynamicModule, Provider } from '@nestjs/common';
import { Logger, Module } from '@nestjs/common';
import { InMemoryInteractionHistoryRepository, InteractiveAIProvider } from '@org/ai';
import { IWorkflowStateRepository, InMemoryWorkflowStateRepository } from '@org/ai-assistant';
import { AuthProvider } from '@org/auth';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { IdGenerator, UuidIdGenerator } from '@org/chore';
import { ClaudeInteractiveAIProvider, createClaudeMessagesClient } from '@org/claude';
import {
  FirebaseClientDataAccess,
  FirebaseInteractionHistoryRepository,
  FirebaseWorkflowStateRepository,
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
} from '@org/supabase';
import type { Environment } from '../config/environment';
import { PORTS } from './ports';

@Module({})
export class ProductionAdaptersModule {
  /** Les ports branchés sur Supabase, Gemini ou Claude, et Firestore, d'après la configuration. */
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

    // Firestore garde l'état de l'assistant (workflows, historique de Claude) : un seul client, créé
    // seulement si `WORKFLOW_STATE_STORE=firestore`.
    let firebase: FirebaseClientDataAccess | undefined;
    const firestore = () =>
      (firebase ??= new FirebaseClientDataAccess({
        projectId: environment.FIREBASE_PROJECT_ID as string,
        clientEmail: environment.FIREBASE_CLIENT_EMAIL,
        privateKey: environment.FIREBASE_PRIVATE_KEY,
        databaseId: environment.FIREBASE_DATABASE_ID,
      }));
    const inMemory = environment.WORKFLOW_STATE_STORE === 'memory';

    // L'API Messages de Claude ne garde rien d'un appel à l'autre : l'historique des échanges est
    // rangé avec l'état des workflows (docs/adr/0009-fournisseur-claude.md).
    const claude = () =>
      new ClaudeInteractiveAIProvider(
        createClaudeMessagesClient(environment.ANTHROPIC_API_KEY as string),
        inMemory
          ? new InMemoryInteractionHistoryRepository()
          : new FirebaseInteractionHistoryRepository(firestore()),
        { model: environment.CLAUDE_MODEL, logger: new Logger('Claude') },
      );

    const gemini = () =>
      new GeminiInteractiveAIProvider(createGeminiInteractionsClient(environment.GEMINI_API_KEY as string), {
        model: environment.GEMINI_MODEL,
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
          useFactory: () => (environment.AI_PROVIDER === 'claude' ? claude() : gemini()),
        },
        {
          provide: IWorkflowStateRepository,
          useFactory: () =>
            inMemory
              ? new InMemoryWorkflowStateRepository()
              : new FirebaseWorkflowStateRepository(firestore()),
        },
      ],
      exports: [...PORTS],
    };
  }
}
