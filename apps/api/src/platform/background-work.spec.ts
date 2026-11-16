import { WaitUntilBackgroundWork } from './background-work';

/** Là où le runtime de Vercel expose la requête en cours (`@vercel/functions` le lit). */
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');
const globals = globalThis as unknown as Record<symbol, unknown>;

describe('WaitUntilBackgroundWork', () => {
  afterEach(() => {
    delete globals[REQUEST_CONTEXT];
  });

  it('confie le travail au waitUntil de la requête Vercel en cours', () => {
    const waitUntil = vi.fn();
    globals[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };
    const work = Promise.resolve();

    new WaitUntilBackgroundWork().keepAliveUntil(work);

    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it('ne fait rien hors de Vercel (serveur Node, développement, tests)', () => {
    expect(() => new WaitUntilBackgroundWork().keepAliveUntil(Promise.resolve())).not.toThrow();
  });
});
