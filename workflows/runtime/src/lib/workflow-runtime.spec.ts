import { BusEvent, InMemoryEventBus } from '@org/event-bus';
import { assign, emit, fromPromise, setup } from 'xstate';
import { WorkflowOwnerMismatchError } from './errors/workflow-owner-mismatch.error';
import { InMemoryWorkflowStateStore } from './memory/in-memory-workflow-state-store';
import { WorkflowDefinition } from './workflow-definition';
import { WorkflowLogger, WorkflowRuntime, WorkflowRuntimeOptions } from './workflow-runtime';

type Context = { owner: string; done: number };

/** Une étape lente, que le test termine quand il veut. */
function slowStep() {
  const pending: Array<() => void> = [];
  const step = {
    started: 0,
    run: () => {
      step.started += 1;
      return new Promise<void>((resolve) => pending.push(resolve));
    },
    finishAll: () => pending.splice(0).forEach((resolve) => resolve()),
  };
  return step;
}

/** Une machine minimale : au repos, puis une étape invoquée, puis de nouveau au repos. */
function counterMachine(step: ReturnType<typeof slowStep>) {
  return setup({
    types: {
      context: {} as Context,
      events: {} as { type: 'start'; owner: string },
      emitted: {} as { type: 'counted'; done: number } | { type: 'audited'; secret: string },
    },
    actors: {
      work: fromPromise<void>(() => step.run()),
    },
  }).createMachine({
    id: 'counter',
    initial: 'idle',
    context: { owner: '', done: 0 },
    states: {
      idle: {
        on: { start: { target: 'working', actions: assign({ owner: ({ event }) => event.owner }) } },
      },
      working: {
        invoke: {
          src: 'work',
          onDone: {
            target: 'idle',
            actions: [
              assign({ done: ({ context }) => context.done + 1 }),
              emit(({ context }) => ({ type: 'counted' as const, done: context.done })),
              emit({ type: 'audited' as const, secret: 'détail technique' }),
            ],
          },
        },
      },
    },
  });
}

type CounterMachine = ReturnType<typeof counterMachine>;

const logger: WorkflowLogger & { errors: unknown[] } = {
  errors: [],
  error(_message, error) {
    this.errors.push(error);
  },
  warn() {
    /* rien */
  },
};

function createRuntime(definition: Partial<WorkflowDefinition<CounterMachine>> = {}) {
  const step = slowStep();
  const machine = counterMachine(step);
  const store = new InMemoryWorkflowStateStore<Context>();
  const bus = new InMemoryEventBus(logger);
  const published: BusEvent[] = [];
  bus.subscribe('*', (event) => void published.push(event));
  let ids = 0;
  const build = (options: WorkflowRuntimeOptions = {}) =>
    new WorkflowRuntime<CounterMachine>(
      {
        name: 'counter',
        machine,
        ownerOf: (state) => state.context.owner || undefined,
        publicEvents: ['counted'],
        ...definition,
      },
      store,
      {
        logger,
        bus,
        newEventId: () => `event-${++ids}`,
        now: () => new Date('2026-11-23T10:00:00.000Z'),
        ...options,
      },
    );

  return { runtime: build(), restart: build, store, step, machine, bus, published };
}

describe('WorkflowRuntime', () => {
  beforeEach(() => {
    logger.errors.length = 0;
  });

  it("ne crée une instance que sur demande, et sauvegarde dès qu'elle existe", async () => {
    const { runtime, store } = createRuntime();

    await expect(runtime.obtain('k', 'alice', { create: false })).resolves.toBeNull();
    expect(store.saves).toBe(0);

    const instance = await runtime.obtain('k', 'alice', { create: true });
    expect(instance).toMatchObject({ key: 'k', ownerId: 'alice' });
    expect(runtime.activeCount).toBe(1);

    await runtime.shutdown();
    await expect(store.findById('k')).resolves.toMatchObject({ id: 'k', value: 'idle' });
    expect(runtime.activeCount).toBe(0);
  });

  it("relance après un redémarrage l'étape qui était en cours", async () => {
    const { runtime, restart, store, step } = createRuntime();
    const instance = await runtime.obtain('k', 'alice', { create: true });

    instance?.actor.send({ type: 'start', owner: 'alice' });
    expect(step.started).toBe(1);
    await runtime.shutdown();
    await expect(store.findById('k')).resolves.toMatchObject({ value: 'working' });

    const restored = await restart().obtain('k', 'alice', { create: false });
    expect(step.started).toBe(2);

    step.finishAll();
    await vi.waitFor(() => expect(restored?.actor.getSnapshot().value).toBe('idle'));
    expect(restored?.actor.getSnapshot().context.done).toBe(1);
  });

  it("refuse de rendre l'état stocké de quelqu'un d'autre", async () => {
    const { runtime, restart, step } = createRuntime();
    const instance = await runtime.obtain('k', 'alice', { create: true });
    instance?.actor.send({ type: 'start', owner: 'alice' });
    step.finishAll();
    await vi.waitFor(() => expect(instance?.actor.getSnapshot().value).toBe('idle'));
    await runtime.shutdown();

    await expect(restart().obtain('k', 'mallory', { create: true })).rejects.toBeInstanceOf(
      WorkflowOwnerMismatchError,
    );
  });

  it("rebâtit l'instance avec la définition quand l'état stocké n'a pas de snapshot XState", async () => {
    const withRecover = createRuntime({
      recover: (state) => withRecover.machine.resolveState({ value: 'idle', context: state.context }),
    });
    await withRecover.store.overwrite({ id: 'k', value: 'idle', context: { owner: 'alice', done: 7 } });

    const recovered = await withRecover.runtime.obtain('k', 'alice', { create: false });
    expect(recovered?.actor.getSnapshot().context.done).toBe(7);

    // Sans `recover`, l'instance repart de l'état initial.
    const plain = createRuntime();
    await plain.store.overwrite({ id: 'k', value: 'idle', context: { owner: 'alice', done: 7 } });
    const fresh = await plain.runtime.obtain('k', 'alice', { create: false });
    expect(fresh?.actor.getSnapshot().context.done).toBe(0);
  });

  it("libère la mémoire des instances au repos, jamais d'une instance en pleine étape", async () => {
    const { restart, step } = createRuntime();
    const runtime = restart({ idleTimeoutMs: 1000 });
    await runtime.obtain('resting', 'alice', { create: true });
    const busy = await runtime.obtain('busy', 'alice', { create: true });
    busy?.actor.send({ type: 'start', owner: 'alice' });

    await expect(runtime.evictIdle(Date.now())).resolves.toEqual([]);
    await expect(runtime.evictIdle(Date.now() + 5000)).resolves.toEqual(['resting']);
    expect(runtime.peek('busy')).toBeDefined();
    expect(runtime.peek('resting')).toBeUndefined();

    step.finishAll();
    await runtime.shutdown();
  });

  it("oublie une instance : plus d'acteur, plus d'état stocké", async () => {
    const { runtime, store } = createRuntime();
    await runtime.obtain('k', 'alice', { create: true });

    await runtime.forget('k');

    expect(runtime.peek('k')).toBeUndefined();
    await expect(store.findById('k')).resolves.toBeNull();
  });

  it('publie les faits annoncés dans leur enveloppe, publics ou internes selon la définition', async () => {
    const { runtime, step, bus, published } = createRuntime();
    const instance = await runtime.obtain('k', 'alice', { create: true });

    instance?.actor.send({ type: 'start', owner: 'alice' });
    step.finishAll();
    await vi.waitFor(() => expect(instance?.actor.getSnapshot().value).toBe('idle'));
    await runtime.idle();
    await bus.idle();

    expect(published).toEqual([
      {
        id: 'event-1',
        type: 'counter.counted',
        source: 'counter',
        key: 'k',
        ownerId: 'alice',
        audience: 'public',
        occurredAt: '2026-11-23T10:00:00.000Z',
        payload: { done: 1 },
      },
      expect.objectContaining({
        type: 'counter.audited',
        audience: 'internal',
        payload: { secret: 'détail technique' },
      }),
    ]);
  });

  it("publie après chaque sauvegarde la vue publique de l'état, quand la définition en donne une", async () => {
    const { runtime, step, bus, published } = createRuntime({
      publicState: (snapshot, key) => ({ key, step: snapshot.value, done: snapshot.context.done }),
    });
    const instance = await runtime.obtain('k', 'alice', { create: true });

    instance?.actor.send({ type: 'start', owner: 'alice' });
    step.finishAll();
    await vi.waitFor(() => expect(instance?.actor.getSnapshot().value).toBe('idle'));
    await runtime.idle();
    await bus.idle();

    expect(published.map(({ type, audience, payload }) => ({ type, audience, payload }))).toEqual([
      { type: 'counter.state.changed', audience: 'public', payload: { key: 'k', step: 'idle', done: 0 } },
      { type: 'counter.state.changed', audience: 'public', payload: { key: 'k', step: 'working', done: 0 } },
      { type: 'counter.counted', audience: 'public', payload: { done: 1 } },
      { type: 'counter.audited', audience: 'internal', payload: { secret: 'détail technique' } },
      { type: 'counter.state.changed', audience: 'public', payload: { key: 'k', step: 'idle', done: 1 } },
    ]);
  });

  it("ne publie un fait qu'après avoir sauvegardé l'état qui l'a produit", async () => {
    const { runtime, step, store, bus } = createRuntime();
    const order: string[] = [];
    const save = store.save.bind(store);
    vi.spyOn(store, 'save').mockImplementation(async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await save(state);
      order.push(`sauvegarde ${String(state.value)} ${state.context.done}`);
    });
    bus.subscribe('counter.counted', () => void order.push('publication'));

    const instance = await runtime.obtain('k', 'alice', { create: true });
    instance?.actor.send({ type: 'start', owner: 'alice' });
    step.finishAll();
    await vi.waitFor(() => expect(instance?.actor.getSnapshot().value).toBe('idle'));
    await runtime.idle();
    await bus.idle();

    expect(order).toEqual(['sauvegarde idle 0', 'sauvegarde working 0', 'sauvegarde idle 1', 'publication']);
  });

  it('publie quand même si la sauvegarde échoue, et ne laisse jamais une panne du bus atteindre la machine', async () => {
    const { runtime, step, store, bus } = createRuntime();
    const saveFailure = new Error('stockage injoignable');
    const busFailure = new Error('bus injoignable');
    vi.spyOn(store, 'save').mockRejectedValue(saveFailure);
    vi.spyOn(bus, 'publish').mockRejectedValue(busFailure);

    const instance = await runtime.obtain('k', 'alice', { create: true });
    instance?.actor.send({ type: 'start', owner: 'alice' });
    step.finishAll();
    await vi.waitFor(() => expect(instance?.actor.getSnapshot().value).toBe('idle'));
    await runtime.idle();

    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(instance?.actor.getSnapshot().status).toBe('active');
    expect(logger.errors).toEqual([saveFailure, saveFailure, saveFailure, busFailure, busFailure]);
  });
});
