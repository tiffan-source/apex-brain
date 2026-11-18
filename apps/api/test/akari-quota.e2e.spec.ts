import { Logger } from '@nestjs/common';
import { AIProviderError } from '@org/ai';
import type { Role } from '@org/user';
import { akariQuotaExceededErrorSchema, workflowStateResponseSchema } from '../src/assistant/assistant.schemas';
import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

type Person = ReturnType<TestApp['signIn']>;

describe("Quota d'Akari (e2e)", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(() => t.close());

  let accounts = 0;
  const person = (roles?: readonly Role[]) => t.signIn(`personne-${++accounts}@apex.test`, roles);

  const createObjective = async (who: Person) => {
    const created = await t
      .http()
      .post('/v2/objectives')
      .set('Authorization', who.authorization)
      .send({ title: 'Courir un marathon' });
    expect(created.status).toBe(201);
    return created.body.id as string;
  };

  const send = (who: Person, objectiveId: string, message = 'Bonjour') =>
    t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/messages`)
      .set('Authorization', who.authorization)
      .send({ message });

  const state = async (who: Person, objectiveId: string) => {
    const response = await t
      .http()
      .get(`/v2/objectives/${objectiveId}/assistant`)
      .set('Authorization', who.authorization);
    expect(response.status).toBe(200);
    return workflowStateResponseSchema.parse(response.body);
  };

  const waitFor = async (who: Person, objectiveId: string, status: 'ready' | 'awaiting-permission') => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const current = await state(who, objectiveId);
      if (current.status === status) return current;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`statut « ${status} » jamais atteint`);
  };

  const respond = (who: Person, objectiveId: string, granted: boolean) =>
    t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/permission`)
      .set('Authorization', who.authorization)
      .send({ granted });

  /** Un tour qui finit par une réponse d'Akari. */
  const succeededTurn = async (who: Person, objectiveId: string) => {
    t.ai.willRespond(t.ai.text("C'est noté."));
    const accepted = await send(who, objectiveId);
    expect(accepted.status).toBe(202);
    const done = await waitFor(who, objectiveId, 'ready');
    expect(done.lastError).toBeNull();
  };

  /** Un tour où Akari propose un pas et attend l'accord de la personne. */
  const turnAwaitingPermission = async (who: Person, objectiveId: string) => {
    t.ai.willRespond(
      t.ai.toolCalls({
        id: `call-${Math.random()}`,
        name: 'createTask',
        arguments: { objectiveId, title: 'Courir 5 km', importance: 4, urgency: 2 },
      }),
      t.ai.text('Très bien.'),
    );
    expect((await send(who, objectiveId)).status).toBe(202);
    await waitFor(who, objectiveId, 'awaiting-permission');
  };

  const expectQuotaExceeded = async (who: Person, objectiveId: string, limit: number) => {
    const refused = await send(who, objectiveId);
    expect(refused.status).toBe(403);
    expect(akariQuotaExceededErrorSchema.parse(refused.body).error.details).toEqual({
      limit,
      used: limit,
      window: 'total',
      resetsAt: null,
    });
  };

  it('laisse une personne standard faire 3 tours réussis, puis refuse avec AKARI_QUOTA_EXCEEDED', async () => {
    const alice = person();
    const objectiveId = await createObjective(alice);

    for (let turn = 0; turn < 3; turn++) await succeededTurn(alice, objectiveId);

    await expectQuotaExceeded(alice, objectiveId, 3);
  });

  it('laisse premium et admin écrire sans limite', async () => {
    for (const role of ['premium', 'admin'] as const) {
      const who = person([role]);
      const objectiveId = await createObjective(who);

      for (let turn = 0; turn < 5; turn++) await succeededTurn(who, objectiveId);
    }
  });

  it('applique la règle la plus généreuse des rôles de la personne', async () => {
    t.akariRules.set('premium', { messageLimit: 4, window: 'total' });
    const both = person(['standard', 'premium']);
    const objectiveId = await createObjective(both);

    for (let turn = 0; turn < 4; turn++) await succeededTurn(both, objectiveId);
    await expectQuotaExceeded(both, objectiveId, 4);

    t.akariRules.set('premium', { messageLimit: null, window: 'total' });
    await succeededTurn(both, objectiveId);
  });

  it('refuse en 403 FORBIDDEN un rôle sans règle, et le signale dans le journal', async () => {
    const warned = vi.spyOn(Logger.prototype, 'warn');
    t.akariRules.delete('premium');
    const premium = person(['premium']);
    const objectiveId = await createObjective(premium);

    const refused = await send(premium, objectiveId);

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('No Akari rule'));
    warned.mockRestore();
  });

  it("ne compte ni un tour en panne, ni un tour abandonné", async () => {
    const alice = person();
    const objectiveId = await createObjective(alice);

    t.ai.willRespond(new AIProviderError('indisponible'));
    await send(alice, objectiveId);
    expect((await waitFor(alice, objectiveId, 'ready')).lastError).not.toBeNull();

    // Abandonné : la personne ne répond jamais à la demande d'accord, puis supprime l'objectif.
    const abandoned = await createObjective(alice);
    await turnAwaitingPermission(alice, abandoned);
    await t.http().delete(`/v2/objectives/${abandoned}`).set('Authorization', alice.authorization);

    for (let turn = 0; turn < 3; turn++) await succeededTurn(alice, objectiveId);
    await expectQuotaExceeded(alice, objectiveId, 3);
  });

  it("compte une fois un tour qui demande un accord, qu'il soit donné ou refusé", async () => {
    const alice = person();
    const objectiveId = await createObjective(alice);

    await turnAwaitingPermission(alice, objectiveId);
    expect((await respond(alice, objectiveId, true)).status).toBe(202);
    await waitFor(alice, objectiveId, 'ready');

    await turnAwaitingPermission(alice, objectiveId);
    expect((await respond(alice, objectiveId, false)).status).toBe(202);
    await waitFor(alice, objectiveId, 'ready');

    await succeededTurn(alice, objectiveId);
    await expectQuotaExceeded(alice, objectiveId, 3);
  });

  it("ne rend pas les messages quand on supprime l'objectif de la conversation", async () => {
    const alice = person();
    const first = await createObjective(alice);
    for (let turn = 0; turn < 3; turn++) await succeededTurn(alice, first);

    const deleted = await t.http().delete(`/v2/objectives/${first}`).set('Authorization', alice.authorization);
    expect(deleted.status).toBeLessThan(300);

    await expectQuotaExceeded(alice, await createObjective(alice), 3);
  });

  it("applique une règle modifiée dès l'envoi suivant", async () => {
    const alice = person();
    const objectiveId = await createObjective(alice);
    await succeededTurn(alice, objectiveId);

    t.akariRules.set('standard', { messageLimit: 1, window: 'total' });
    await expectQuotaExceeded(alice, objectiveId, 1);

    t.akariRules.set('standard', { messageLimit: null, window: 'total' });
    await succeededTurn(alice, objectiveId);

    t.akariRules.delete('standard');
    const refused = await send(alice, objectiveId);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
  });

  it("laisse lire l'état et répondre à une demande d'accord quand le quota est épuisé", async () => {
    const alice = person();
    const objectiveId = await createObjective(alice);
    await turnAwaitingPermission(alice, objectiveId);

    // Le quota s'épuise pendant que le tour attend l'accord.
    t.akariRules.set('standard', { messageLimit: 0, window: 'total' });

    await expect(state(alice, objectiveId)).resolves.toMatchObject({ status: 'awaiting-permission' });
    expect((await respond(alice, objectiveId, true)).status).toBe(202);
    await expect(waitFor(alice, objectiveId, 'ready')).resolves.toMatchObject({
      lastRegisteredMessage: { sender: 'AI', content: 'Très bien.' },
    });

    const refused = await send(alice, objectiveId);
    expect(akariQuotaExceededErrorSchema.parse(refused.body).error.details).toMatchObject({
      limit: 0,
      used: 1,
    });
  });

  it("enregistre chaque tour réussi sous l'id de la réponse d'Akari", async () => {
    const alice = person();
    const objectiveId = await createObjective(alice);

    await succeededTurn(alice, objectiveId);

    const { lastRegisteredMessage } = await state(alice, objectiveId);
    expect([...t.akariUsages.usages]).toEqual([
      [lastRegisteredMessage?.id, { ownerId: alice.id, objectiveId, at: t.clock.now() }],
    ]);
  });
});
