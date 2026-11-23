import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Inject, Logger, Module } from '@nestjs/common';
import { InteractiveAIProvider } from '@org/ai';
import { AkariAccess, AkariRuleSource, AkariUsageJournal, Clock } from '@org/akari-access';
import type { ConversationMachine, WorkflowContext } from '@org/ai-assistant';
import {
  AIService,
  aiAssistantWorkflow,
  AkariSystemContextProvider,
  ChatService,
  CreateSubObjectiveTool,
  CreateTaskTool,
  GetObjectiveTreeTool,
  SendMessageToAIWorkflow,
  SystemContextProvider,
  ToolExecutor,
  ToolPolicy,
  ToolRegistry,
} from '@org/ai-assistant';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { IdGenerator } from '@org/chore';
import { ObjectiveInternalService, ObjectiveRepository } from '@org/objective';
import type { WorkflowLogger } from '@org/workflow-runtime';
import { WorkflowRuntime, WorkflowStateStore } from '@org/workflow-runtime';
import type { Environment } from '../config/environment';
import { APP_ENVIRONMENT } from '../config/environment';
import { AkariQuotaGuard } from './akari-quota.guard';
import { AssistantController } from './assistant.controller';

/** Toutes les minutes, les workflows au repos depuis trop longtemps quittent la mémoire. */
const EVICTION_INTERVAL_MS = 60_000;

/** Le runtime qui héberge les instances de la machine de l'assistant, une par objectif. */
export const ASSISTANT_RUNTIME = Symbol('ASSISTANT_RUNTIME');

const nestLogger = new Logger('Assistant');

/** Les journaux du runtime et du workflow, dans ceux de Nest. */
const assistantLogger: WorkflowLogger = {
  // Une panne de tour arrive sans objet d'erreur (tout est dans le message) : lui passer
  // `String(undefined)` faisait imprimer une ligne « undefined » à Nest après chaque panne.
  error: (message, error) =>
    error === undefined
      ? nestLogger.error(message)
      : nestLogger.error(message, error instanceof Error ? error.stack : String(error)),
  warn: (message) => nestLogger.warn(message),
};

/** L'assistant : l'orchestrateur XState et ses acteurs, assemblés sur les ports. */
@Module({
  controllers: [AssistantController],
  providers: [
    {
      provide: AkariAccess,
      useFactory: (rules: AkariRuleSource, journal: AkariUsageJournal, clock: Clock) =>
        new AkariAccess(rules, journal, clock),
      inject: [AkariRuleSource, AkariUsageJournal, Clock],
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
      provide: ChatService,
      useFactory: (query: GetConversationsQuery, addMessage: AddMessageCommand) =>
        new ChatService(query, addMessage),
      inject: [GetConversationsQuery, AddMessageCommand],
    },
    {
      // La machine de l'assistant, munie de ses ports, confiée au runtime (docs/adr/0010).
      provide: ASSISTANT_RUNTIME,
      useFactory: (
        environment: Environment,
        chat: ChatService,
        ai: InteractiveAIProvider,
        registry: ToolRegistry,
        systemContext: SystemContextProvider,
        ids: IdGenerator,
        states: WorkflowStateStore<WorkflowContext>,
        akariAccess: AkariAccess,
      ): WorkflowRuntime<ConversationMachine> =>
        new WorkflowRuntime(
          aiAssistantWorkflow(
            {
              chatService: chat,
              aiService: new AIService(ai),
              toolExecutor: new ToolExecutor(registry),
              toolPolicy: new ToolPolicy(registry),
              toolRegistry: registry,
              systemContextProvider: systemContext,
              idGenerator: ids,
              // Chaque tour réussi entre au journal d'usage d'Akari, sous l'id de la réponse. Le
              // workflow n'en sait pas plus : ni rôles, ni quotas (ADR 0004, 0008).
              onTurnSucceeded: (turn) => akariAccess.record(turn),
            },
            assistantLogger,
          ),
          states,
          {
            idleTimeoutMs: environment.ASSISTANT_IDLE_TIMEOUT_MINUTES * 60_000,
            logger: assistantLogger,
          },
        ),
      inject: [
        APP_ENVIRONMENT,
        ChatService,
        InteractiveAIProvider,
        ToolRegistry,
        SystemContextProvider,
        IdGenerator,
        WorkflowStateStore,
        AkariAccess,
      ],
    },
    {
      // Les règles d'une requête (à qui la conversation, un tour en cours…), par-dessus le runtime.
      provide: SendMessageToAIWorkflow,
      useFactory: (runtime: WorkflowRuntime<ConversationMachine>, chat: ChatService) =>
        new SendMessageToAIWorkflow({ runtime, chatService: chat, logger: assistantLogger }),
      inject: [ASSISTANT_RUNTIME, ChatService],
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
