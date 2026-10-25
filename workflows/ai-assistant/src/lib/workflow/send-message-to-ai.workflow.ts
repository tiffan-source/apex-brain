import { ConversationNotFoundError } from '@org/chat';
import { Result, runWithResult } from '@org/chore';
import { Actor, createActor, InspectionEvent, Observer, Snapshot, Subscription } from 'xstate';
import { NoPendingPermissionError } from '../errors/no-pending-permission.error';
import { WorkflowBusyError } from '../errors/workflow-busy.error';
import {
  IWorkflowStateRepository,
  WORKFLOW_READY_FOR_NEW_MESSAGE,
  WorkflowContext,
  WorkflowState,
  WorkflowStateValue,
} from '../model/workflow.model';
import { ConversationMachine, getMachine, initialWorkflowContext, MachineDependencies } from './machine';
import {
  initialWorkflowStateView,
  isAwaitingPermission,
  isRestingValue,
  toWorkflowStateView,
  WorkflowStateView,
} from './workflow-state.view';

export type SendMessageToAIWorkflowDependencies = MachineDependencies & {
  workflowStateRepository: IWorkflowStateRepository;
};

export interface WorkflowLogger {
  error(message: string, error?: unknown): void;
  warn(message: string): void;
}

export type SendMessageToAIWorkflowOptions = {
  /** Après ce délai sans activité, un workflow au repos quitte la mémoire (il reste persisté). Défaut : 30 min. */
  idleTimeoutMs?: number;
  /** Observateur d'inspection XState (désactivé par défaut). */
  inspect?: Observer<InspectionEvent> | ((event: InspectionEvent) => void);
  logger?: WorkflowLogger;
};

type TrackedWorkflow = {
  actor: Actor<ConversationMachine>;
  ownerId: string;
  lastActivity: number;
  /** Les sauvegardes partent l'une après l'autre : une ancienne n'écrase jamais une plus récente. */
  persisting: Promise<void>;
  subscription?: Subscription;
};

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const consoleLogger: WorkflowLogger = {
  error: (message, error) => console.error(message, error),
  warn: (message) => console.warn(message),
};

/**
 * Le workflow « envoyer un message à l'IA », un acteur XState par objectif.
 *
 * Chaque méthode vérifie d'abord que la conversation de l'objectif appartient à la personne, puis
 * reprend l'acteur en mémoire, le restaure depuis son état persisté, ou le crée. Chaque transition
 * est persistée ; restaurer un snapshot relance l'étape qui était en cours.
 */
export class SendMessageToAIWorkflow {
  private readonly machine: ConversationMachine;
  private readonly workflows = new Map<string, TrackedWorkflow>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly logger: WorkflowLogger;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly deps: SendMessageToAIWorkflowDependencies,
    private readonly options: SendMessageToAIWorkflowOptions = {},
  ) {
    this.machine = getMachine(deps);
    this.logger = options.logger ?? consoleLogger;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  /**
   * L'état du workflow de cet objectif. Un workflow persisté est remis en mémoire (et son tour
   * interrompu reprend) ; un workflow qui n'a jamais servi est décrit sans être créé.
   */
  getState(objectiveId: string, ownerId: string): Promise<Result<WorkflowStateView>> {
    return runWithResult(
      async () => {
        await this.authorize(objectiveId, ownerId);
        const tracked = await this.obtain(objectiveId, ownerId, false);
        return tracked ? this.view(objectiveId, tracked) : initialWorkflowStateView(objectiveId);
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
        const tracked = await this.require(objectiveId, ownerId);

        if (tracked.actor.getSnapshot().value !== WORKFLOW_READY_FOR_NEW_MESSAGE) {
          throw new WorkflowBusyError(objectiveId);
        }

        tracked.actor.send({ type: 'message.send', userId: ownerId, objectiveId, prompt: message });
        return this.view(objectiveId, tracked);
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
        const tracked = await this.obtain(objectiveId, ownerId, false);
        const snapshot = tracked?.actor.getSnapshot();

        if (
          !tracked ||
          !snapshot ||
          !isAwaitingPermission(snapshot.value as WorkflowStateValue) ||
          (toolCallId !== undefined && snapshot.context.currentToolCall?.id !== toolCallId)
        ) {
          throw new NoPendingPermissionError(objectiveId);
        }

        tracked.actor.send({ type: 'user.response', permission });
        return this.view(objectiveId, tracked);
      },
      [ConversationNotFoundError, NoPendingPermissionError],
      'Failed to answer the permission request',
    );
  }

  /**
   * Libérer la mémoire des workflows au repos depuis plus que le délai d'inactivité. Ils restent
   * persistés et seront restaurés au prochain accès. Rend les ids libérés.
   */
  async evictIdle(now = Date.now()): Promise<string[]> {
    const evicted: string[] = [];

    for (const objectiveId of [...this.workflows.keys()]) {
      await this.withLock(objectiveId, async () => {
        const tracked = this.workflows.get(objectiveId);
        if (!tracked) return;

        const value = tracked.actor.getSnapshot().value as WorkflowStateValue;
        if (!isRestingValue(value) || now - tracked.lastActivity < this.idleTimeoutMs) return;

        await this.release(objectiveId, tracked);
        evicted.push(objectiveId);
      });
    }

    return evicted;
  }

  /** Attendre les sauvegardes en cours puis arrêter tous les acteurs (arrêt du serveur). */
  async shutdown(): Promise<void> {
    for (const [objectiveId, tracked] of [...this.workflows]) {
      await this.withLock(objectiveId, () => this.release(objectiveId, tracked));
    }
  }

  /** Le nombre de workflows en mémoire. */
  get activeWorkflowCount(): number {
    return this.workflows.size;
  }

  private async authorize(objectiveId: string, ownerId: string): Promise<void> {
    const tracked = this.workflows.get(objectiveId);

    if (tracked) {
      if (tracked.ownerId !== ownerId) throw new ConversationNotFoundError(objectiveId);
      return;
    }

    if (!(await this.deps.chatService.hasConversation(objectiveId, ownerId))) {
      throw new ConversationNotFoundError(objectiveId);
    }
  }

  private async require(objectiveId: string, ownerId: string): Promise<TrackedWorkflow> {
    return (await this.obtain(objectiveId, ownerId, true)) as TrackedWorkflow;
  }

  /** L'acteur en mémoire, sinon restauré, sinon (si `create`) un nouvel acteur. */
  private obtain(objectiveId: string, ownerId: string, create: boolean): Promise<TrackedWorkflow | null> {
    return this.withLock(objectiveId, async () => {
      const tracked = this.workflows.get(objectiveId);

      if (tracked && tracked.actor.getSnapshot().status === 'active') {
        tracked.lastActivity = Date.now();
        return tracked;
      }

      if (tracked) {
        // Acteur arrêté par une erreur inattendue : on repart de son dernier état persisté.
        await this.release(objectiveId, tracked);
      }

      const state = await this.deps.workflowStateRepository.findById(objectiveId);

      if (state) {
        if (state.context?.userId && state.context.userId !== ownerId) {
          throw new ConversationNotFoundError(objectiveId);
        }
        return this.startRestored(objectiveId, ownerId, state);
      }

      return create ? this.track(objectiveId, ownerId, createActor(this.machine, this.actorOptions())) : null;
    });
  }

  private startRestored(objectiveId: string, ownerId: string, state: WorkflowState): TrackedWorkflow {
    const persisted = state.persistedSnapshot as Snapshot<unknown> | undefined;

    if (persisted && persisted.status === 'active') {
      try {
        return this.track(
          objectiveId,
          ownerId,
          createActor(this.machine, { ...this.actorOptions(), snapshot: persisted as never }),
        );
      } catch (error) {
        this.logger.error(`Workflow ${objectiveId}: the persisted snapshot could not be restored`, error);
      }
    }

    // Document d'Apex (valeur + contexte), ou snapshot inutilisable. Un état au repos se reprend
    // tel quel ; un tour qui était en cours ne peut pas être relancé : on revient au repos et on le dit.
    const resting = isRestingValue(state.value);
    const context: WorkflowContext = { ...initialWorkflowContext(), ...state.context };
    const snapshot = this.machine.resolveState({
      value: resting ? state.value : WORKFLOW_READY_FOR_NEW_MESSAGE,
      context: resting
        ? context
        : {
            ...context,
            aiResponse: null,
            toolCallResults: [],
            currentToolCall: undefined,
            lastError: {
              code: 'TURN_INTERRUPTED',
              message: 'The turn was interrupted and could not be resumed',
              step: typeof state.value === 'string' ? state.value : JSON.stringify(state.value),
              at: new Date().toISOString(),
            },
          },
    });

    return this.track(objectiveId, ownerId, createActor(this.machine, { ...this.actorOptions(), snapshot }));
  }

  private track(objectiveId: string, ownerId: string, actor: Actor<ConversationMachine>): TrackedWorkflow {
    const tracked: TrackedWorkflow = {
      actor,
      ownerId,
      lastActivity: Date.now(),
      persisting: Promise.resolve(),
    };

    let lastReportedError = actor.getSnapshot().context.lastError?.at;

    tracked.subscription = actor.subscribe({
      next: (snapshot) => {
        tracked.lastActivity = Date.now();

        // Une panne de tour (IA, base…) n'arrête pas le workflow : on la journalise ici, avec son détail.
        const error = snapshot.context.lastError;
        if (error && error.at !== lastReportedError) {
          lastReportedError = error.at;
          this.logger.error(`Workflow ${objectiveId}: ${error.code} during ${error.step}: ${error.message}`);
        }

        this.schedulePersist(objectiveId, tracked, snapshot);
      },
      error: (error) => this.logger.error(`Workflow ${objectiveId} stopped on an unexpected error`, error),
    });

    actor.start();
    this.workflows.set(objectiveId, tracked);
    return tracked;
  }

  private schedulePersist(
    objectiveId: string,
    tracked: TrackedWorkflow,
    snapshot: ReturnType<Actor<ConversationMachine>['getSnapshot']>,
  ): void {
    if (snapshot.status !== 'active') return;

    // Copie figée au moment de la transition (les dates deviennent des chaînes, comme en base).
    const state: WorkflowState = JSON.parse(
      JSON.stringify({
        id: objectiveId,
        value: snapshot.value,
        context: snapshot.context,
        persistedSnapshot: tracked.actor.getPersistedSnapshot(),
        updatedAt: new Date().toISOString(),
      }),
    );

    tracked.persisting = tracked.persisting
      .then(() => this.deps.workflowStateRepository.save(state))
      .catch((error) => this.logger.error(`Failed to persist workflow ${objectiveId}`, error));
  }

  private async release(objectiveId: string, tracked: TrackedWorkflow): Promise<void> {
    await tracked.persisting;
    tracked.subscription?.unsubscribe();
    tracked.actor.stop();
    if (this.workflows.get(objectiveId) === tracked) this.workflows.delete(objectiveId);
  }

  private view(objectiveId: string, tracked: TrackedWorkflow): WorkflowStateView {
    const snapshot = tracked.actor.getSnapshot();
    return toWorkflowStateView(objectiveId, {
      value: snapshot.value as WorkflowStateValue,
      context: snapshot.context,
    });
  }

  private actorOptions() {
    return this.options.inspect ? { inspect: this.options.inspect } : {};
  }

  /** Une file par workflow : chargement, création et libération ne se croisent jamais. */
  private withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );

    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });

    return run;
  }
}
