import { ScriptedAIProvider } from '@org/ai/testing';
import { createInMemoryChatInfrastructure } from '@org/chat/testing';
import { SequentialIdGenerator } from '@org/chore/testing';
import { ObjectiveInternalService } from '@org/objective';
import { createInMemoryObjectiveInfrastructure, seedObjective } from '@org/objective/testing';
import { AIService } from '../ai/ai.service';
import { ChatService } from '../chat/chat.service';
import { AkariSystemContextProvider } from '../context/system-context.provider';
import { InMemoryWorkflowStateRepository } from '../persistence/in-memory-workflow-state.repository';
import { CreateSubObjectiveTool } from '../tools/create-sub-objective.tool';
import { CreateTaskTool } from '../tools/create-task.tool';
import { GetObjectiveTreeTool } from '../tools/get-objective-tree.tool';
import { ToolExecutor } from '../tools/tool-executor';
import { ToolPolicy } from '../tools/tool-policy';
import { ToolRegistry } from '../tools/tool-registry';
import {
  SendMessageToAIWorkflow,
  SendMessageToAIWorkflowDependencies,
  SendMessageToAIWorkflowOptions,
  WorkflowLogger,
} from '../workflow/send-message-to-ai.workflow';
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
 * (avec sa conversation), Mallory possède `m1`.
 */
export function createWorkflowHarness(options: SendMessageToAIWorkflowOptions = {}) {
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
  const workflowStateRepository = new InMemoryWorkflowStateRepository();

  const deps: SendMessageToAIWorkflowDependencies = {
    chatService: new ChatService(chat.getConversationsQuery, chat.addMessageCommand),
    aiService: new AIService(ai),
    toolExecutor: new ToolExecutor(toolRegistry),
    toolPolicy: new ToolPolicy(toolRegistry),
    toolRegistry,
    systemContextProvider: new AkariSystemContextProvider(),
    idGenerator: new SequentialIdGenerator('message'),
    workflowStateRepository,
  };

  const build = (overrides: SendMessageToAIWorkflowOptions = {}) =>
    new SendMessageToAIWorkflow(deps, { logger: silentLogger, ...options, ...overrides });

  return {
    workflow: build(),
    /** Un autre processus sur le même stockage (un redémarrage du serveur). */
    restart: build,
    deps,
    ai,
    chat,
    objectives,
    workflowStateRepository,
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
