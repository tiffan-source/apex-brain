import type {
  Actor,
  ActorOptions,
  AnyMachineSnapshot,
  AnyStateMachine,
  ContextFrom,
  InspectionEvent,
  Observer,
  Snapshot,
  SnapshotFrom,
  Subscription,
} from 'xstate';
import { createActor } from 'xstate';
import { WorkflowOwnerMismatchError } from './errors/workflow-owner-mismatch.error';
import { StoredWorkflowState, WorkflowStateStore } from './protocols/workflow-state-store';
import { WorkflowDefinition } from './workflow-definition';

export interface WorkflowLogger {
  error(message: string, error?: unknown): void;
  warn(message: string): void;
}

export type WorkflowRuntimeOptions = {
  /** Après ce délai sans activité, une instance au repos quitte la mémoire (elle reste stockée). Défaut : 30 min. */
  idleTimeoutMs?: number;
  /** Observateur d'inspection XState (désactivé par défaut). */
  inspect?: Observer<InspectionEvent> | ((event: InspectionEvent) => void);
  logger?: WorkflowLogger;
};

/** Une instance en mémoire : sa clé, la personne à qui elle appartient, son acteur. */
export type WorkflowInstance<TMachine extends AnyStateMachine> = {
  readonly key: string;
  readonly ownerId: string;
  readonly actor: Actor<TMachine>;
};

/** Ce qu'un observateur apprend à chaque transition d'une instance. */
export type WorkflowSnapshotChange<TMachine extends AnyStateMachine> = {
  instance: WorkflowInstance<TMachine>;
  snapshot: SnapshotFrom<TMachine>;
  /** Le snapshot d'avant la transition. */
  previous: SnapshotFrom<TMachine>;
};

type Tracked<TMachine extends AnyStateMachine> = {
  key: string;
  ownerId: string;
  actor: Actor<TMachine>;
  lastActivity: number;
  /** Les sauvegardes partent l'une après l'autre : une ancienne n'écrase jamais une plus récente. */
  persisting: Promise<void>;
  subscription?: Subscription;
  previous: SnapshotFrom<TMachine>;
};

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const consoleLogger: WorkflowLogger = {
  error: (message, error) => console.error(message, error),
  warn: (message) => console.warn(message),
};

/** Au repos par défaut : aucune étape en cours, c'est-à-dire aucun acteur invoqué. */
function hasNoRunningStep(snapshot: Snapshot<unknown>): boolean {
  return Object.keys((snapshot as AnyMachineSnapshot).children ?? {}).length === 0;
}

/**
 * Le runtime des workflows : il héberge les acteurs XState d'un workflow, un par clé, et garde leur état.
 *
 * Il crée l'instance d'une clé à la demande, ou la restaure depuis son état stocké (restaurer un snapshot
 * relance l'étape qui était en cours). Chaque transition est sauvegardée, dans l'ordre. Les instances au
 * repos quittent la mémoire après un délai d'inactivité ; à l'arrêt, les sauvegardes en cours se
 * terminent. Il ne sait rien du workflow au-delà de sa définition (`WorkflowDefinition`).
 */
export class WorkflowRuntime<TMachine extends AnyStateMachine> {
  private readonly instances = new Map<string, Tracked<TMachine>>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly observers = new Set<(change: WorkflowSnapshotChange<TMachine>) => void>();
  private readonly logger: WorkflowLogger;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly definition: WorkflowDefinition<TMachine>,
    private readonly store: WorkflowStateStore<ContextFrom<TMachine>>,
    private readonly options: WorkflowRuntimeOptions = {},
  ) {
    this.logger = options.logger ?? consoleLogger;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  /** Le nom du workflow hébergé. */
  get name(): string {
    return this.definition.name;
  }

  /** Le nombre d'instances en mémoire. */
  get activeCount(): number {
    return this.instances.size;
  }

  /** L'instance de cette clé si elle est en mémoire, sans rien charger ni créer. */
  peek(key: string): WorkflowInstance<TMachine> | undefined {
    return this.instances.get(key);
  }

  /**
   * L'instance de cette clé : en mémoire, sinon restaurée depuis son état stocké, sinon (si `create`) créée
   * pour `ownerId`. `null` quand rien n'existe et que `create` est faux. Un état stocké qui appartient à
   * quelqu'un d'autre lève `WorkflowOwnerMismatchError`.
   */
  obtain(key: string, ownerId: string, { create }: { create: boolean }): Promise<WorkflowInstance<TMachine> | null> {
    return this.withLock(key, async () => {
      const tracked = this.instances.get(key);

      if (tracked && (tracked.actor.getSnapshot() as AnyMachineSnapshot).status === 'active') {
        tracked.lastActivity = Date.now();
        return tracked;
      }

      if (tracked) {
        // Acteur arrêté par une erreur inattendue : on repart de son dernier état stocké.
        await this.release(key, tracked);
      }

      const state = await this.store.findById(key);

      if (state) {
        const owner = this.definition.ownerOf?.(state);
        if (owner && owner !== ownerId) throw new WorkflowOwnerMismatchError(key);
        return this.startRestored(key, ownerId, state);
      }

      return create ? this.track(key, ownerId, this.createActor()) : null;
    });
  }

  /**
   * Observer chaque transition de chaque instance (après la transition, avant sa sauvegarde). Un observateur
   * qui lance est journalisé, sans gêner les autres ni la machine. Rend de quoi se désabonner.
   */
  onSnapshot(observer: (change: WorkflowSnapshotChange<TMachine>) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  /**
   * Oublier une instance : l'acteur s'arrête, même en pleine étape, et l'état stocké disparaît. Une panne du
   * stockage est journalisée sans remonter.
   */
  forget(key: string): Promise<void> {
    return this.withLock(key, async () => {
      const tracked = this.instances.get(key);

      if (tracked) {
        // Dans cet ordre : plus aucune transition n'est sauvegardée, puis on attend celles qui
        // sont parties. Aucune écriture ne peut ainsi recréer l'état après sa suppression.
        this.instances.delete(key);
        tracked.subscription?.unsubscribe();
        tracked.actor.stop();
        await tracked.persisting;
      }

      try {
        await this.store.delete(key);
      } catch (error) {
        this.logger.error(`Workflow ${key}: the persisted state could not be deleted`, error);
      }
    });
  }

  /**
   * Libérer la mémoire des instances au repos depuis plus que le délai d'inactivité. Elles restent stockées
   * et seront restaurées au prochain accès. Rend les clés libérées.
   */
  async evictIdle(now = Date.now()): Promise<string[]> {
    const evicted: string[] = [];

    for (const key of [...this.instances.keys()]) {
      await this.withLock(key, async () => {
        const tracked = this.instances.get(key);
        if (!tracked) return;

        if (!this.isResting(tracked.actor.getSnapshot()) || now - tracked.lastActivity < this.idleTimeoutMs) return;

        await this.release(key, tracked);
        evicted.push(key);
      });
    }

    return evicted;
  }

  /** Attendre les sauvegardes en cours puis arrêter toutes les instances (arrêt du serveur). */
  async shutdown(): Promise<void> {
    for (const [key, tracked] of [...this.instances]) {
      await this.withLock(key, () => this.release(key, tracked));
    }
  }

  private startRestored(
    key: string,
    ownerId: string,
    state: StoredWorkflowState<ContextFrom<TMachine>>,
  ): Tracked<TMachine> {
    const persisted = state.persistedSnapshot as Snapshot<unknown> | undefined;

    if (persisted && persisted.status === 'active') {
      try {
        return this.track(key, ownerId, this.createActor(persisted));
      } catch (error) {
        this.logger.error(`Workflow ${key}: the persisted snapshot could not be restored`, error);
      }
    }

    // Un ancien format, ou un snapshot inutilisable : la définition sait le rebâtir ; sinon, on repart de zéro.
    return this.track(key, ownerId, this.createActor(this.definition.recover?.(state)));
  }

  private track(key: string, ownerId: string, actor: Actor<TMachine>): Tracked<TMachine> {
    const tracked: Tracked<TMachine> = {
      key,
      ownerId,
      actor,
      lastActivity: Date.now(),
      persisting: Promise.resolve(),
      previous: actor.getSnapshot(),
    };

    tracked.subscription = actor.subscribe({
      next: (snapshot) => {
        tracked.lastActivity = Date.now();
        this.notify(tracked, snapshot);
        tracked.previous = snapshot;
        this.schedulePersist(tracked, snapshot);
      },
      error: (error) => this.logger.error(`Workflow ${key} stopped on an unexpected error`, error),
    });

    actor.start();
    this.instances.set(key, tracked);
    return tracked;
  }

  private notify(tracked: Tracked<TMachine>, snapshot: SnapshotFrom<TMachine>): void {
    for (const observer of this.observers) {
      try {
        observer({ instance: tracked, snapshot, previous: tracked.previous });
      } catch (error) {
        this.logger.error(`Workflow ${tracked.key}: a snapshot observer failed`, error);
      }
    }
  }

  private schedulePersist(tracked: Tracked<TMachine>, snapshot: SnapshotFrom<TMachine>): void {
    const machineSnapshot = snapshot as AnyMachineSnapshot;
    if (machineSnapshot.status !== 'active') return;

    // Copie figée au moment de la transition (les dates deviennent des chaînes, comme en base).
    const state = JSON.parse(
      JSON.stringify({
        id: tracked.key,
        value: machineSnapshot.value,
        context: machineSnapshot.context,
        persistedSnapshot: tracked.actor.getPersistedSnapshot(),
        updatedAt: new Date().toISOString(),
      }),
    ) as StoredWorkflowState<ContextFrom<TMachine>>;

    tracked.persisting = tracked.persisting
      .then(() => this.store.save(state))
      .catch((error) => this.logger.error(`Failed to persist workflow ${tracked.key}`, error));
  }

  private isResting(snapshot: SnapshotFrom<TMachine>): boolean {
    return this.definition.isResting ? this.definition.isResting(snapshot) : hasNoRunningStep(snapshot);
  }

  private async release(key: string, tracked: Tracked<TMachine>): Promise<void> {
    await tracked.persisting;
    tracked.subscription?.unsubscribe();
    tracked.actor.stop();
    if (this.instances.get(key) === tracked) this.instances.delete(key);
  }

  /** Un acteur de la machine, neuf ou repris d'un snapshot. */
  private createActor(snapshot?: Snapshot<unknown>): Actor<TMachine> {
    const options: ActorOptions<AnyStateMachine> = {
      ...(this.options.inspect ? { inspect: this.options.inspect } : {}),
      ...(snapshot ? { snapshot } : {}),
    };
    return createActor(this.definition.machine as AnyStateMachine, options) as Actor<TMachine>;
  }

  /** Une file par clé : chargement, création et libération ne se croisent jamais. */
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
