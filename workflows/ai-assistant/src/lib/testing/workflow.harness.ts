import { ScriptedAIProvider } from '@org/ai/testing';
import { createInMemoryChatInfrastructure } from '@org/chat/testing';
import { SequentialIdGenerator } from '@org/chore/testing';
import { ObjectiveInternalService } from '@org/objective';
import { BusEvent, InMemoryEventBus } from '@org/event-bus';
import { createInMemoryObjectiveInfrastructure, seedObjective } from '@org/objective/testing';
import {
  InMemoryWorkflowStateStore,
  WorkflowLogger,
  WorkflowRuntime,
  WorkflowRuntimeOptions,
} from '@org/workflow-runtime';
import { AIService } from '../ai/ai.service';
import { ChatService } from '../chat/chat.service';
import { AkariSystemContextProvider } from '../context/system-context.provider';
import { CreateSubObjectiveTool } from '../tools/create-sub-objective.tool';
import { CreateTaskTool } from '../tools/create-task.tool';
import { GetObjectiveTreeTool } from '../tools/get-objective-tree.tool';
import { ToolExecutor } from '../tools/tool-executor';
import { ToolPolicy } from '../tools/tool-policy';
import { ToolRegistry } from '../tools/tool-registry';
import { WorkflowContext, WorkflowStateValue } from '../model/workflow.model';
import { aiAssistantWorkflow } from '../workflow/ai-assistant.workflow';
import { ConversationMachine, MachineDependencies } from '../workflow/machine';
import { SendMessageToAIWorkflow } from '../workflow/send-message-to-ai.workflow';
import { WorkflowStateView, WorkflowStatus } from '../workflow/workflow-state.view';

export const silentLogger: WorkflowLogger & { errors: unknown[] } = {
  errors: [],
  error(_message, error) {
    this.errors.push(error);
  },
  warn() {
    /* rien */
  },
};

/**
 * Un workflow complet branché sur des doublures en mémoire : Alice possède l'objectif `o1`
 * (avec sa conversation), Mallory possède `m1`. Le runtime et le workflow sont construits comme dans
 * l'API : la définition de l'assistant confiée à un runtime, et les règles d'une requête par-dessus.
 */
export function createWorkflowHarness(options: WorkflowRuntimeOptions = {}) {
  const objectives = createInMemoryObjectiveInfrastructure();
  const chat = createInMemoryChatInfrastructure();
  const ai = new ScriptedAIProvider();

  seedObjective(objectives.db, { id: 'o1', ownerId: 'alice', title: 'Courir un marathon' });
  seedObjective(objectives.db, { id: 'm1', ownerId: 'mallory', title: 'Objectif de Mallory' });
  chat.db.createConversation('o1', 'alice');
  chat.db.createConversation('m1', 'mallory');

  const objectiveService = new ObjectiveInternalService(
    objectives.objectiveRepository,
    new SequentialIdGenerator('created'),
  );
  const toolRegistry = new ToolRegistry([
    new GetObjectiveTreeTool(objectiveService),
    new CreateSubObjectiveTool(objectiveService),
    new CreateTaskTool(objectiveService),
  ]);
  const workflowStates = new InMemoryWorkflowStateStore<WorkflowContext, WorkflowStateValue>();
  const bus = new InMemoryEventBus(silentLogger);
  /** Tout ce que les workflows ont publié, dans l'ordre. */
  const events: BusEvent[] = [];
  bus.subscribe('*', (event) => void events.push(event));
  const runtimes: Array<WorkflowRuntime<ConversationMachine>> = [];

  const deps: MachineDependencies = {
    chatService: new ChatService(chat.getConversationsQuery, chat.addMessageCommand),
    aiService: new AIService(ai),
    toolExecutor: new ToolExecutor(toolRegistry),
    toolPolicy: new ToolPolicy(toolRegistry),
    toolRegistry,
    systemContextProvider: new AkariSystemContextProvider(),
    idGenerator: new SequentialIdGenerator('message'),
  };

  const build = (overrides: WorkflowRuntimeOptions = {}) => {
    const runtime = new WorkflowRuntime(aiAssistantWorkflow(deps), workflowStates, {
      logger: silentLogger,
      bus,
      ...options,
      ...overrides,
    });
    runtimes.push(runtime);
    return new SendMessageToAIWorkflow({ runtime, chatService: deps.chatService, now: deps.now });
  };

  return {
    workflow: build(),
    /** Un autre processus sur le même stockage (un redémarrage du serveur). */
    restart: build,
    deps,
    ai,
    chat,
    objectives,
    workflowStates,
    bus,
    events,
    /** Attendre que les sauvegardes, les publications et leurs abonnés aient fini. */
    settle: async () => {
      for (const runtime of runtimes) await runtime.idle();
      await bus.idle();
    },
  };
}

/** Interroger le workflow jusqu'à ce qu'il atteigne ce statut (comme le client, chaque seconde, en accéléré). */
export async function waitForStatus(
  workflow: SendMessageToAIWorkflow,
  status: WorkflowStatus,
  objectiveId = 'o1',
  ownerId = 'alice',
  timeoutMs = 2000,
): Promise<WorkflowStateView> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await workflow.getState(objectiveId, ownerId);
    if (result.success && result.data.status === status) return result.data;
    if (Date.now() > deadline) {
      throw new Error(`Le workflow n'atteint pas « ${status} » : ${JSON.stringify(result)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
