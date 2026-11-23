import { ConversationNotFoundError } from '@org/chat';
import { Result, runWithResult } from '@org/chore';
import type { WorkflowInstance, WorkflowLogger, WorkflowRuntime } from '@org/workflow-runtime';
import { WorkflowOwnerMismatchError } from '@org/workflow-runtime';
import { NoPendingPermissionError } from '../errors/no-pending-permission.error';
import { WorkflowBusyError } from '../errors/workflow-busy.error';
import { WORKFLOW_READY_FOR_NEW_MESSAGE, WorkflowStateValue } from '../model/workflow.model';
import { IChatActor } from './actors.protocols';
import { ConversationMachine } from './machine';
import {
  initialWorkflowStateView,
  isAwaitingPermission,
  toWorkflowStateView,
  WorkflowStateView,
} from './workflow-state.view';

export type SendMessageToAIWorkflowDependencies = {
  /** Les instances de la machine de l'assistant (`aiAssistantWorkflow`), hébergées par le runtime. */
  runtime: WorkflowRuntime<ConversationMachine>;
  /** Pour vérifier qu'une conversation appartient à la personne. */
  chatService: IChatActor;
  /** L'horloge de l'état rendu aux clients, remplaçable dans les tests. */
  now?: () => Date;
  logger?: WorkflowLogger;
};

type AssistantInstance = WorkflowInstance<ConversationMachine>;

const consoleLogger: WorkflowLogger = {
  error: (message, error) => console.error(message, error),
  warn: (message) => console.warn(message),
};

/**
 * Le workflow « envoyer un message à l'IA » : les règles d'une requête, une instance de la machine par
 * objectif.
 *
 * Chaque méthode vérifie d'abord que la conversation de l'objectif appartient à la personne, puis demande au
 * runtime l'instance de l'objectif : en mémoire, restaurée depuis son état persisté, ou créée. Le runtime
 * héberge les acteurs et persiste chaque transition ; restaurer un snapshot relance l'étape qui était en cours.
 */
export class SendMessageToAIWorkflow {
  private readonly runtime: WorkflowRuntime<ConversationMachine>;
  private readonly logger: WorkflowLogger;

  constructor(private readonly deps: SendMessageToAIWorkflowDependencies) {
    this.runtime = deps.runtime;
    this.logger = deps.logger ?? consoleLogger;

    // Une panne de tour (IA, base…) n'arrête pas le workflow : on la journalise ici, avec son détail.
    this.runtime.onSnapshot(({ instance, snapshot, previous }) => {
      const error = snapshot.context.lastError;
      if (error && error.at !== previous.context.lastError?.at) {
        this.logger.error(`Workflow ${instance.key}: ${error.code} during ${error.step}: ${error.message}`);
      }
    });
  }

  /**
   * L'état du workflow de cet objectif. Un workflow persisté est remis en mémoire (et son tour
   * interrompu reprend) ; un workflow qui n'a jamais servi est décrit sans être créé.
   */
  getState(objectiveId: string, ownerId: string): Promise<Result<WorkflowStateView>> {
    return runWithResult(
      async () => {
        await this.authorize(objectiveId, ownerId);
        const instance = await this.obtain(objectiveId, ownerId, false);
        return instance ? this.view(objectiveId, instance) : initialWorkflowStateView(objectiveId);
      },
      [ConversationNotFoundError],
      'Failed to read the workflow state',
    );
  }

  /** Démarrer le workflow de cet objectif, ou le reprendre s'il existe déjà. */
  startWorkFlow(objectiveId: string, ownerId: string): Promise<Result<WorkflowStateView>> {
    return runWithResult(
      async () => {
        await this.authorize(objectiveId, ownerId);
        return this.view(objectiveId, await this.require(objectiveId, ownerId));
      },
      [ConversationNotFoundError],
      'Failed to start the workflow',
    );
  }

  /** Envoyer un message : refusé (`WORKFLOW_BUSY`) tant qu'un tour est en cours. */
  sendMessage(objectiveId: string, ownerId: string, message: string): Promise<Result<WorkflowStateView>> {
    return runWithResult(
      async () => {
        await this.authorize(objectiveId, ownerId);
        const instance = await this.require(objectiveId, ownerId);

        if (instance.actor.getSnapshot().value !== WORKFLOW_READY_FOR_NEW_MESSAGE) {
          throw new WorkflowBusyError(objectiveId);
        }

        instance.actor.send({ type: 'message.send', userId: ownerId, objectiveId, prompt: message });
        return this.view(objectiveId, instance);
      },
      [ConversationNotFoundError, WorkflowBusyError],
      'Failed to send the message',
    );
  }

  /**
   * Répondre à une demande de permission d'exécution d'outil : transmet à la
   * machine (en attente dans WaitingForUserPermission) la décision de
   * l'utilisateur. `true` exécute l'outil, `false` l'annule.
   *
   * `toolCallId`, s'il est donné, doit être celui de l'outil en attente : une réponse à une
   * demande déjà passée est refusée.
   */
  respondToPermission(
    objectiveId: string,
    ownerId: string,
    permission: boolean,
    toolCallId?: string,
  ): Promise<Result<WorkflowStateView>> {
    return runWithResult(
      async () => {
        await this.authorize(objectiveId, ownerId);
        const instance = await this.obtain(objectiveId, ownerId, false);
        const snapshot = instance?.actor.getSnapshot();

        if (
          !instance ||
          !snapshot ||
          !isAwaitingPermission(snapshot.value as WorkflowStateValue) ||
          (toolCallId !== undefined && snapshot.context.currentToolCall?.id !== toolCallId)
        ) {
          throw new NoPendingPermissionError(objectiveId);
        }

        instance.actor.send({ type: 'user.response', permission });
        return this.view(objectiveId, instance);
      },
      [ConversationNotFoundError, NoPendingPermissionError],
      'Failed to answer the permission request',
    );
  }

  /**
   * Oublier le workflow d'un objectif supprimé : l'acteur s'arrête, même en plein tour, et l'état
   * persisté disparaît (il vit hors de la base, où la cascade ne l'atteint pas).
   *
   * À appeler une fois l'objectif supprimé : cette suppression a vérifié le propriétaire, et la
   * conversation n'est plus là pour le faire ici. Une panne du stockage est journalisée sans
   * remonter : l'objectif est déjà supprimé, et sans conversation cet état ne sera plus jamais lu.
   */
  forget(objectiveId: string): Promise<void> {
    return this.runtime.forget(objectiveId);
  }

  /**
   * Libérer la mémoire des workflows au repos depuis plus que le délai d'inactivité. Ils restent
   * persistés et seront restaurés au prochain accès. Rend les ids libérés.
   */
  evictIdle(now = Date.now()): Promise<string[]> {
    return this.runtime.evictIdle(now);
  }

  /** Attendre les sauvegardes en cours puis arrêter tous les acteurs (arrêt du serveur). */
  shutdown(): Promise<void> {
    return this.runtime.shutdown();
  }

  /** Le nombre de workflows en mémoire. */
  get activeWorkflowCount(): number {
    return this.runtime.activeCount;
  }

  private async authorize(objectiveId: string, ownerId: string): Promise<void> {
    const instance = this.runtime.peek(objectiveId);

    if (instance) {
      if (instance.ownerId !== ownerId) throw new ConversationNotFoundError(objectiveId);
      return;
    }

    if (!(await this.deps.chatService.hasConversation(objectiveId, ownerId))) {
      throw new ConversationNotFoundError(objectiveId);
    }
  }

  private async require(objectiveId: string, ownerId: string): Promise<AssistantInstance> {
    return (await this.obtain(objectiveId, ownerId, true)) as AssistantInstance;
  }

  /** L'instance en mémoire, sinon restaurée, sinon (si `create`) une nouvelle instance. */
  private async obtain(objectiveId: string, ownerId: string, create: boolean): Promise<AssistantInstance | null> {
    try {
      return await this.runtime.obtain(objectiveId, ownerId, { create });
    } catch (error) {
      // L'état persisté appartient à quelqu'un d'autre : pour cette personne, il n'y a pas de conversation.
      if (error instanceof WorkflowOwnerMismatchError) throw new ConversationNotFoundError(objectiveId);
      throw error;
    }
  }

  private view(objectiveId: string, instance: AssistantInstance): WorkflowStateView {
    const snapshot = instance.actor.getSnapshot();
    return toWorkflowStateView(
      objectiveId,
      {
        value: snapshot.value as WorkflowStateValue,
        context: snapshot.context,
      },
      this.deps.now?.() ?? new Date(),
    );
  }
}
