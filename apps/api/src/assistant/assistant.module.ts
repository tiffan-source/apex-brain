import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Inject, Logger, Module } from '@nestjs/common';
import { InteractiveAIProvider } from '@org/ai';
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
import { ObjectiveInternalService } from '@org/objective';
import type { Environment } from '../config/environment';
import { APP_ENVIRONMENT } from '../config/environment';
import { ObjectivesModule } from '../objectives/objectives.module';
import { AssistantController } from './assistant.controller';

/** Toutes les minutes, les workflows au repos depuis trop longtemps quittent la mémoire. */
const EVICTION_INTERVAL_MS = 60_000;

/** L'assistant : l'orchestrateur XState et ses acteurs, assemblés sur les ports. */
@Module({
  imports: [ObjectivesModule],
  controllers: [AssistantController],
  providers: [
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
          },
          {
            idleTimeoutMs: environment.ASSISTANT_IDLE_TIMEOUT_MINUTES * 60_000,
            logger: {
              error: (message, error) =>
                logger.error(message, error instanceof Error ? error.stack : String(error)),
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
