import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Inject, Logger, Module } from '@nestjs/common';
import { InteractiveAIProvider } from '@org/ai';
import {
  AkariRulesQuery,
  AkariUsageRepository,
  AuthorizeAkariMessageUseCase,
  Clock,
  RecordAkariUsageUseCase,
} from '@org/akari-access';
import {
  AIService,
  AkariSystemContextProvider,
  ChatService,
  CreateSubObjectiveTool,
  CreateTaskTool,
  GetObjectiveTreeTool,
  IWorkflowStateRepository,
  SendMessageToAIWorkflow,
  SystemContextProvider,
  ToolExecutor,
  ToolPolicy,
  ToolRegistry,
} from '@org/ai-assistant';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { IdGenerator } from '@org/chore';
import { ObjectiveInternalService, ObjectiveRepository } from '@org/objective';
import type { Environment } from '../config/environment';
import { APP_ENVIRONMENT } from '../config/environment';
import { AkariQuotaGuard } from './akari-quota.guard';
import { AssistantController } from './assistant.controller';

/** Toutes les minutes, les workflows au repos depuis trop longtemps quittent la mémoire. */
const EVICTION_INTERVAL_MS = 60_000;

/** L'assistant : l'orchestrateur XState et ses acteurs, assemblés sur les ports. */
@Module({
  controllers: [AssistantController],
  providers: [
    {
      provide: AuthorizeAkariMessageUseCase,
      useFactory: (rules: AkariRulesQuery, usages: AkariUsageRepository, clock: Clock) =>
        new AuthorizeAkariMessageUseCase(rules, usages, clock),
      inject: [AkariRulesQuery, AkariUsageRepository, Clock],
    },
    {
      provide: RecordAkariUsageUseCase,
      useFactory: (usages: AkariUsageRepository, clock: Clock) => new RecordAkariUsageUseCase(usages, clock),
      inject: [AkariUsageRepository, Clock],
    },
    AkariQuotaGuard,
    {
      provide: ObjectiveInternalService,
      useFactory: (repository: ObjectiveRepository, ids: IdGenerator) =>
        new ObjectiveInternalService(repository, ids),
      inject: [ObjectiveRepository, IdGenerator],
    },
    { provide: SystemContextProvider, useFactory: () => new AkariSystemContextProvider() },
    {
      provide: ToolRegistry,
      useFactory: (objectives: ObjectiveInternalService) =>
        new ToolRegistry([
          new GetObjectiveTreeTool(objectives),
          new CreateSubObjectiveTool(objectives),
          new CreateTaskTool(objectives),
        ]),
      inject: [ObjectiveInternalService],
    },
    {
      provide: SendMessageToAIWorkflow,
      useFactory: (
        environment: Environment,
        query: GetConversationsQuery,
        addMessage: AddMessageCommand,
        ai: InteractiveAIProvider,
        registry: ToolRegistry,
        systemContext: SystemContextProvider,
        ids: IdGenerator,
        states: IWorkflowStateRepository,
        recordUsage: RecordAkariUsageUseCase,
      ) => {
        const logger = new Logger('Assistant');
        return new SendMessageToAIWorkflow(
          {
            chatService: new ChatService(query, addMessage),
            aiService: new AIService(ai),
            toolExecutor: new ToolExecutor(registry),
            toolPolicy: new ToolPolicy(registry),
            toolRegistry: registry,
            systemContextProvider: systemContext,
            idGenerator: ids,
            workflowStateRepository: states,
            // Chaque tour réussi entre au journal d'usage d'Akari, sous l'id de la réponse. Le
            // workflow n'en sait pas plus : ni rôles, ni quotas (ADR 0004, 0008).
            onTurnSucceeded: async (turn) => {
              const recorded = await recordUsage.execute(turn);
              if (!recorded.success) throw new Error(`${recorded.error.code}: ${recorded.error.message}`);
            },
          },
          {
            idleTimeoutMs: environment.ASSISTANT_IDLE_TIMEOUT_MINUTES * 60_000,
            logger: {
              // Une panne de tour arrive sans objet d'erreur (tout est dans le message) : lui passer
              // `String(undefined)` faisait imprimer une ligne « undefined » à Nest après chaque panne.
              error: (message, error) =>
                error === undefined
                  ? logger.error(message)
                  : logger.error(message, error instanceof Error ? error.stack : String(error)),
              warn: (message) => logger.warn(message),
            },
          },
        );
      },
      inject: [
        APP_ENVIRONMENT,
        GetConversationsQuery,
        AddMessageCommand,
        InteractiveAIProvider,
        ToolRegistry,
        SystemContextProvider,
        IdGenerator,
        IWorkflowStateRepository,
        RecordAkariUsageUseCase,
      ],
    },
  ],
  exports: [SendMessageToAIWorkflow],
})
export class AssistantModule implements OnModuleInit, OnApplicationShutdown {
  private evictionTimer?: NodeJS.Timeout;

  constructor(@Inject(SendMessageToAIWorkflow) private readonly workflow: SendMessageToAIWorkflow) {}

  onModuleInit(): void {
    this.evictionTimer = setInterval(() => void this.workflow.evictIdle(), EVICTION_INTERVAL_MS);
    this.evictionTimer.unref();
  }

  /** À l'arrêt, les sauvegardes en cours se terminent : un tour interrompu reprendra au démarrage suivant. */
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.evictionTimer);
    await this.workflow.shutdown();
  }
}
