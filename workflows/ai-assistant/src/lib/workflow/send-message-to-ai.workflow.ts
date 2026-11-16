import { ConversationNotFoundError } from '@org/chat';
import { Result, runWithResult } from '@org/chore';
import { Actor, createActor, InspectionEvent, Observer, Snapshot, Subscription, waitFor } from 'xstate';
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
  /**
   * Plusieurs instances servent les mêmes workflows (fonctions Vercel, ADR 0009) : la durée pendant
   * laquelle un tour en cours appartient à l'instance qui le mène, comptée depuis sa dernière
   * sauvegarde. Les autres instances le lisent sans le reprendre et refusent d'en lancer un autre ;
   * au-delà, il est abandonné (son instance a disparu) et la première qui le lit le reprend. Elle
   * doit couvrir la durée maximale d'une invocation.
   *
   * Absent ou 0 : un seul processus sert tous les workflows, la mémoire fait foi (comportement
   * d'origine, ADR 0004).
   */
  turnOwnershipMs?: number;
  /**
   * Prévenu de chaque tour que ce processus lance ou reprend, avec la promesse de sa fin : au repos
   * ou en attente d'un accord, sauvegardes faites. Le tour continue après la réponse HTTP ; un
   * hébergeur qui fige le processus dès la réponse envoyée (fonction Vercel) doit le savoir pour le
   * garder en vie jusque-là. La promesse ne rejette jamais.
   */
  keepAlive?: (turn: Promise<void>) => void;
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

/**
 * Où se trouve un workflow : un acteur dans ce processus, ou seulement son état persisté (un tour
 * mené par une autre instance, ou un workflow au repos qu'une lecture n'a pas besoin de démarrer).
 */
type Located = { tracked: TrackedWorkflow } | { persisted: WorkflowState };

/** Ce qu'on veut faire du workflow : le lire, agir sur lui s'il existe, ou le démarrer au besoin. */
type Purpose = 'read' | 'act' | 'start';

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
 *
 * Avec `turnOwnershipMs`, plusieurs instances se partagent les workflows : l'état persisté fait foi,
 * une instance ne se fie à sa mémoire que pour le tour qu'elle mène (ADR 0009).
 */
export class SendMessageToAIWorkflow {
  private readonly machine: ConversationMachine;
  private readonly workflows = new Map<string, TrackedWorkflow>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly logger: WorkflowLogger;
  private readonly idleTimeoutMs: number;
  private readonly turnOwnershipMs: number;

  constructor(
    private readonly deps: SendMessageToAIWorkflowDependencies,
    private readonly options: SendMessageToAIWorkflowOptions = {},
  ) {
    this.machine = getMachine(deps);
    this.logger = options.logger ?? consoleLogger;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.turnOwnershipMs = options.turnOwnershipMs ?? 0;
  }

  /**
   * L'état du workflow de cet objectif. Un workflow persisté est remis en mémoire (et son tour
   * interrompu reprend) ; un workflow qui n'a jamais servi est décrit sans être créé. Sur plusieurs
   * instances, un workflow au repos ou un tour mené ailleurs est décrit d'après son état persisté.
   */
  getState(objectiveId: string, ownerId: string): Promise<Result<WorkflowStateView>> {
    return runWithResult(
      async () => {
        await this.authorize(objectiveId, ownerId);
        const located = await this.locate(objectiveId, ownerId, 'read');
        return located ? this.viewOf(objectiveId, located) : initialWorkflowStateView(objectiveId);
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
        return this.viewOf(objectiveId, await this.locateOrStart(objectiveId, ownerId));
      },
      [ConversationNotFoundError],
      'Failed to start the workflow',
    );
  }

  /**
   * Envoyer un message : refusé (`WORKFLOW_BUSY`) tant qu'un tour est en cours, ici ou dans une
   * autre instance.
   */
  sendMessage(objectiveId: string, ownerId: string, message: string): Promise<Result<WorkflowStateView>> {
    return runWithResult(
      async () => {
        await this.authorize(objectiveId, ownerId);
        const located = await this.locateOrStart(objectiveId, ownerId);

        if (!('tracked' in located)) throw new WorkflowBusyError(objectiveId);
        const { tracked } = located;

        if (tracked.actor.getSnapshot().value !== WORKFLOW_READY_FOR_NEW_MESSAGE) {
          throw new WorkflowBusyError(objectiveId);
        }

        tracked.actor.send({ type: 'message.send', userId: ownerId, objectiveId, prompt: message });
        this.keepAliveUntilSettled(tracked);
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
        const located = await this.locate(objectiveId, ownerId, 'act');
        const tracked = located && 'tracked' in located ? located.tracked : undefined;
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
        this.keepAliveUntilSettled(tracked);
        return this.view(objectiveId, tracked);
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
    return this.withLock(objectiveId, async () => {
      const tracked = this.workflows.get(objectiveId);

      if (tracked) {
        // Dans cet ordre : plus aucune transition n'est sauvegardée, puis on attend celles qui
        // sont parties. Aucune écriture ne peut ainsi recréer l'état après sa suppression.
        this.workflows.delete(objectiveId);
        tracked.subscription?.unsubscribe();
        tracked.actor.stop();
        await tracked.persisting;
      }

      try {
        await this.deps.workflowStateRepository.delete(objectiveId);
      } catch (error) {
        this.logger.error(`Workflow ${objectiveId}: the persisted state could not be deleted`, error);
      }
    });
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

  /** Plusieurs instances se partagent-elles les workflows (`turnOwnershipMs`) ? */
  private get sharedAcrossInstances(): boolean {
    return this.turnOwnershipMs > 0;
  }

  private async locateOrStart(objectiveId: string, ownerId: string): Promise<Located> {
    return (await this.locate(objectiveId, ownerId, 'start')) as Located;
  }

  /**
   * L'acteur en mémoire, sinon restauré depuis l'état persisté, sinon (pour `start`) un nouvel acteur.
   *
   * Sur plusieurs instances, la mémoire ne fait foi que pour un tour que ce processus mène : un
   * acteur au repos a pu être devancé par une autre instance (un accord donné ailleurs, un nouveau
   * message), il est relu depuis l'état persisté. Un tour en cours qui appartient à une autre
   * instance n'est jamais repris ici : il est seulement décrit.
   */
  private locate(objectiveId: string, ownerId: string, purpose: Purpose): Promise<Located | null> {
    return this.withLock(objectiveId, async () => {
      const tracked = this.workflows.get(objectiveId);

      if (
        tracked &&
        tracked.actor.getSnapshot().status === 'active' &&
        !(this.sharedAcrossInstances && isRestingValue(this.valueOf(tracked)))
      ) {
        tracked.lastActivity = Date.now();
        return { tracked };
      }

      if (tracked) {
        // Acteur arrêté par une erreur inattendue, ou au repos et peut-être périmé : on repart de
        // son dernier état persisté (ses propres sauvegardes sont attendues avant de le relire).
        await this.release(objectiveId, tracked);
      }

      const state = await this.deps.workflowStateRepository.findById(objectiveId);

      if (!state) {
        return purpose === 'start'
          ? { tracked: this.track(objectiveId, ownerId, createActor(this.machine, this.actorOptions())) }
          : null;
      }

      if (state.context?.userId && state.context.userId !== ownerId) {
        throw new ConversationNotFoundError(objectiveId);
      }

      if (this.sharedAcrossInstances) {
        if (this.isOwnedByAnotherInstance(state)) return { persisted: state };
        // Au repos, une lecture n'a pas besoin d'acteur : il ne serait qu'une copie de plus à tenir à jour.
        if (purpose === 'read' && isRestingValue(state.value)) return { persisted: state };
      }

      return { tracked: this.startRestored(objectiveId, ownerId, state) };
    });
  }

  /**
   * Un tour en cours, sauvegardé il y a moins de `turnOwnershipMs` : l'instance qui le mène est
   * vivante. Plus vieux (ou sans date, document d'Apex), il est abandonné et peut être repris.
   */
  private isOwnedByAnotherInstance(state: WorkflowState): boolean {
    if (isRestingValue(state.value) || !state.updatedAt) return false;
    return this.now().getTime() - Date.parse(state.updatedAt) < this.turnOwnershipMs;
  }

  private startRestored(objectiveId: string, ownerId: string, state: WorkflowState): TrackedWorkflow {
    const persisted = state.persistedSnapshot as Snapshot<unknown> | undefined;

    if (persisted && persisted.status === 'active') {
      try {
        const tracked = this.track(
          objectiveId,
          ownerId,
          createActor(this.machine, { ...this.actorOptions(), snapshot: persisted as never }),
        );
        // Restaurer un tour interrompu relance son étape : ce processus le mène désormais.
        if (!isRestingValue(this.valueOf(tracked))) this.keepAliveUntilSettled(tracked);
        return tracked;
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
            activity: [],
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
        updatedAt: this.now().toISOString(),
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
    return toWorkflowStateView(
      objectiveId,
      {
        value: snapshot.value as WorkflowStateValue,
        context: snapshot.context,
      },
      this.now(),
    );
  }

  private viewOf(objectiveId: string, located: Located): WorkflowStateView {
    if ('tracked' in located) return this.view(objectiveId, located.tracked);

    const { value, context } = located.persisted;
    return toWorkflowStateView(
      objectiveId,
      { value, context: { ...initialWorkflowContext(), ...context } },
      this.now(),
    );
  }

  private valueOf(tracked: TrackedWorkflow): WorkflowStateValue {
    return tracked.actor.getSnapshot().value as WorkflowStateValue;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Prévenir l'hébergeur (`keepAlive`) qu'un tour tourne ici jusqu'à son terme. */
  private keepAliveUntilSettled(tracked: TrackedWorkflow): void {
    this.options.keepAlive?.(this.untilSettled(tracked));
  }

  /**
   * Le terme du tour en cours : au repos ou en attente d'un accord (ou acteur arrêté), et toutes
   * ses sauvegardes faites. Ne rejette jamais.
   */
  private async untilSettled(tracked: TrackedWorkflow): Promise<void> {
    const settled = (snapshot: ReturnType<Actor<ConversationMachine>['getSnapshot']>) =>
      snapshot.status !== 'active' || isRestingValue(snapshot.value as WorkflowStateValue);

    // Un acteur arrêté (objectif supprimé, arrêt du serveur) fait rejeter `waitFor` : le tour est
    // terminé quand même.
    await waitFor(tracked.actor, settled).catch(() => undefined);

    // Une sauvegarde peut en suivre une autre : on attend la dernière.
    let persisting: Promise<void>;
    do {
      persisting = tracked.persisting;
      await persisting;
    } while (persisting !== tracked.persisting);
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
