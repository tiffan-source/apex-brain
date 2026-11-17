import { Controller, Get, Module } from '@nestjs/common';
import { AIProviderError } from '@org/ai';
import { workflowStateResponseSchema } from '../src/assistant/assistant.schemas';
import { UsageAction } from '../src/http/usage-action';
import { usageResponseSchema } from '../src/usage/usage.schemas';
import type { TestApp } from './support/test-app';
import { createTestApp, LAUNCH_USAGE_POLICIES } from './support/test-app';

const SEND = 'assistant.send-message';

/**
 * Une action réservée à certains rôles, comme le sera le choix du modèle d'IA : une route qui n'existe que
 * pour ce test, déclarée comme le ferait la vraie.
 */
@Controller('usage-probe')
class UsageProbeController {
  @Get('select-model')
  @UsageAction({ action: 'probe.select-model' })
  selectModel() {
    return { opened: true };
  }
}

@Module({ controllers: [UsageProbeController] })
class UsageProbeModule {}

type Person = ReturnType<TestApp['signIn']>;

describe("Politiques d'usage (e2e)", () => {
  let t: TestApp;

  const start = async (overrides: Record<string, string> = {}) => {
    t = await createTestApp(overrides, { usagePolicies: LAUNCH_USAGE_POLICIES, modules: [UsageProbeModule] });
  };

  afterEach(() => t?.close());

  const createObjective = async (who: Person, title = 'Courir un marathon') =>
    (await t.http().post('/v2/objectives').set('Authorization', who.authorization).send({ title })).body
      .id as string;

  const send = (who: Person, objectiveId: string, message = 'Une question') =>
    t
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/messages`)
      .set('Authorization', who.authorization)
      .send({ message });

  const state = async (who: Person, objectiveId: string) =>
    workflowStateResponseSchema.parse(
      (await t.http().get(`/v2/objectives/${objectiveId}/assistant`).set('Authorization', who.authorization))
        .body,
    );

  /** Interroger l'état comme le client, jusqu'au statut attendu. */
  const waitFor = async (who: Person, objectiveId: string, status: 'ready' | 'awaiting-permission') => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const current = await state(who, objectiveId);
      if (current.status === status) return current;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`statut « ${status} » jamais atteint`);
  };

  /** Un tour complet : le message, puis la réponse d'Akari. */
  const turn = async (who: Person, objectiveId: string, answer = 'Réponse.') => {
    t.ai.willRespond(t.ai.text(answer));
    const response = await send(who, objectiveId);
    expect(response.status).toBe(202);
    await waitFor(who, objectiveId, 'ready');
  };

  const usage = async (who: Person) => {
    const response = await t.http().get('/v2/usage').set('Authorization', who.authorization);
    expect(response.status).toBe(200);
    return usageResponseSchema.parse(response.body);
  };

  const sendMessageUsage = async (who: Person) =>
    (await usage(who)).actions.find((action) => action.action === SEND);

  describe('trois messages pour un compte standard', () => {
    beforeEach(() => start());

    it('accepte trois messages, puis refuse le quatrième en 403 QUOTA_EXCEEDED sans rien enregistrer', async () => {
      const alice = t.signIn('alice@apex.test');
      const objectiveId = await createObjective(alice);

      for (let i = 0; i < 3; i++) await turn(alice, objectiveId);
      const refused = await send(alice, objectiveId, 'Encore une ?');

      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({ error: { code: 'QUOTA_EXCEEDED', message: expect.any(String) } });
      expect(t.chat.db.messages.size).toBe(6);
      expect(t.ai.calls).toHaveLength(3);
      await expect(usage(alice)).resolves.toEqual({
        actions: [
          {
            action: SEND,
            access: 'limited',
            quota: 3,
            used: 3,
            remaining: 0,
            period: 'lifetime',
            resetsAt: null,
          },
        ],
      });
    });

    it('compte chaque personne à part', async () => {
      const alice = t.signIn('alice@apex.test');
      const bob = t.signIn('bob@apex.test');
      const aliceObjective = await createObjective(alice);
      const bobObjective = await createObjective(bob);

      for (let i = 0; i < 3; i++) await turn(alice, aliceObjective);

      await turn(bob, bobObjective);
      await expect(sendMessageUsage(bob)).resolves.toMatchObject({ used: 1, remaining: 2 });
    });

    it("ne compte que l'envoi d'un message : relire l'état et répondre à une demande d'accord restent libres", async () => {
      const alice = t.signIn('alice@apex.test');
      const objectiveId = await createObjective(alice);
      await turn(alice, objectiveId);
      await turn(alice, objectiveId);

      t.ai.willRespond(
        t.ai.toolCalls({
          id: 'call-1',
          name: 'createTask',
          arguments: { objectiveId, title: 'Courir 5 km', importance: 4, urgency: 2 },
        }),
        t.ai.text("C'est ajouté."),
      );
      expect((await send(alice, objectiveId, 'Ajoute un pas')).status).toBe(202);
      await waitFor(alice, objectiveId, 'awaiting-permission');
      await expect(sendMessageUsage(alice)).resolves.toMatchObject({ used: 3, remaining: 0 });

      const granted = await t
        .http()
        .post(`/v2/objectives/${objectiveId}/assistant/permission`)
        .set('Authorization', alice.authorization)
        .send({ granted: true, toolCallId: 'call-1' });
      expect(granted.status).toBe(202);
      await waitFor(alice, objectiveId, 'ready');

      expect(t.objectives.db.tasks.size).toBe(1);
      expect((await send(alice, objectiveId)).status).toBe(403);
    });

    it('ne dépasse pas le quota quand plusieurs messages partent en même temps vers plusieurs objectifs', async () => {
      const alice = t.signIn('alice@apex.test');
      const first = await createObjective(alice, 'Premier');
      await turn(alice, first);
      await turn(alice, first);
      const others = [
        await createObjective(alice, 'Deuxième'),
        await createObjective(alice, 'Troisième'),
        await createObjective(alice, 'Quatrième'),
      ];
      t.ai.willRespond(t.ai.text('Un.'), t.ai.text('Deux.'), t.ai.text('Trois.'));

      const responses = await Promise.all(others.map((objectiveId) => send(alice, objectiveId)));

      expect(responses.map((response) => response.status).sort()).toEqual([202, 403, 403]);
      await expect(sendMessageUsage(alice)).resolves.toMatchObject({ used: 3 });
    });
  });

  describe("l'unité rendue quand l'action n'a pas eu lieu", () => {
    beforeEach(() => start());

    it("rend l'unité d'un tour arrêté par une panne de l'IA : on ne fait pas payer la panne", async () => {
      const alice = t.signIn('alice@apex.test');
      const objectiveId = await createObjective(alice);
      t.ai.willRespond(new AIProviderError('quota'));

      expect((await send(alice, objectiveId)).status).toBe(202);
      const failed = await waitFor(alice, objectiveId, 'ready');

      expect(failed.lastError?.code).toBe('AI_PROVIDER_FAILURE');
      await vi.waitFor(async () => expect(await sendMessageUsage(alice)).toMatchObject({ used: 0 }));

      await turn(alice, objectiveId);
      await expect(sendMessageUsage(alice)).resolves.toMatchObject({ used: 1, remaining: 2 });
    });

    it('rend l’unité quand la route échoue : 409 WORKFLOW_BUSY, 404, 400', async () => {
      const alice = t.signIn('alice@apex.test');
      const mallory = t.signIn('mallory@apex.test');
      const objectiveId = await createObjective(alice);
      const malloryObjective = await createObjective(mallory);
      t.ai.willRespond(() => new Promise(() => undefined));
      expect((await send(alice, objectiveId)).status).toBe(202);

      const busy = await send(alice, objectiveId, 'Et sinon ?');
      const notMine = await send(alice, malloryObjective);
      const empty = await send(alice, objectiveId, '   ');

      expect([busy.status, notMine.status, empty.status]).toEqual([409, 404, 400]);
      expect(busy.body.error.code).toBe('WORKFLOW_BUSY');
      await expect(sendMessageUsage(alice)).resolves.toMatchObject({ used: 1, remaining: 2 });
    });

    it('ne réserve rien sans jeton', async () => {
      const alice = t.signIn('alice@apex.test');
      const objectiveId = await createObjective(alice);

      const anonymous = await t
        .http()
        .post(`/v2/objectives/${objectiveId}/assistant/messages`)
        .send({ message: 'Coucou' });

      expect(anonymous.status).toBe(401);
      expect(t.usageLedger.counts.size).toBe(0);
    });
  });

  it('ne réserve rien au-delà de la limite de débit : les gardes passent avant les politiques', async () => {
    await start({ THROTTLE_ASSISTANT_MESSAGE_LIMIT: '1' });
    const alice = t.signIn('alice@apex.test');
    const objectiveId = await createObjective(alice);
    t.ai.willRespond(() => new Promise(() => undefined));

    expect((await send(alice, objectiveId)).status).toBe(202);
    expect((await send(alice, objectiveId)).status).toBe(429);

    await expect(sendMessageUsage(alice)).resolves.toMatchObject({ used: 1 });
  });

  describe('premium et admin', () => {
    beforeEach(() => start());

    it('ne les limite pas, et ne les compte même pas', async () => {
      const paula = t.signIn('paula@apex.test', ['premium']);
      const adam = t.signIn('adam@apex.test', ['admin']);
      const paulaObjective = await createObjective(paula);
      const adamObjective = await createObjective(adam);

      for (let i = 0; i < 5; i++) {
        await turn(paula, paulaObjective);
        await turn(adam, adamObjective);
      }

      expect(t.usageLedger.counts.size).toBe(0);
      await expect(usage(paula)).resolves.toEqual({ actions: [{ action: SEND, access: 'unlimited' }] });
      await expect(usage(adam)).resolves.toEqual({ actions: [{ action: SEND, access: 'unlimited' }] });
    });
  });

  describe('une stratégie qui change sans déploiement', () => {
    beforeEach(() => start());

    it('applique une politique changée dès la requête suivante', async () => {
      const alice = t.signIn('alice@apex.test');
      const paula = t.signIn('paula@apex.test', ['premium']);
      const aliceObjective = await createObjective(alice);
      const paulaObjective = await createObjective(paula);
      for (let i = 0; i < 3; i++) await turn(alice, aliceObjective);
      for (let i = 0; i < 5; i++) await turn(paula, paulaObjective);

      // Le compte standard passe à cinq messages.
      t.usagePolicies.set({ action: SEND, role: 'standard', quota: 5, period: 'lifetime' });
      await turn(alice, aliceObjective);

      // Premium passe à dix messages par mois : on ne le comptait pas, il part de zéro.
      t.usagePolicies.set({ action: SEND, role: 'premium', quota: 10, period: 'month' });
      await turn(paula, paulaObjective);
      await expect(sendMessageUsage(paula)).resolves.toMatchObject({
        access: 'limited',
        quota: 10,
        used: 1,
        period: 'month',
        resetsAt: expect.stringMatching(/^\d{4}-\d{2}-01T00:00:00\.000Z$/),
      });
      await expect(sendMessageUsage(alice)).resolves.toMatchObject({ quota: 5, used: 4, remaining: 1 });
    });

    it('se débranche en retirant les lignes de l’action : plus rien n’est vérifié ni compté', async () => {
      const alice = t.signIn('alice@apex.test');
      const objectiveId = await createObjective(alice);
      for (let i = 0; i < 3; i++) await turn(alice, objectiveId);
      expect((await send(alice, objectiveId)).status).toBe(403);

      t.usagePolicies.removeAction(SEND);

      await turn(alice, objectiveId);
      await turn(alice, objectiveId);
      await expect(usage(alice)).resolves.toEqual({ actions: [] });
    });
  });

  describe('une action réservée à certains rôles (le choix du modèle, demain)', () => {
    beforeEach(async () => {
      await start();
      t.usagePolicies.set({ action: 'probe.select-model', role: 'premium', quota: null, period: 'lifetime' });
      t.usagePolicies.set({ action: 'probe.select-model', role: 'admin', quota: null, period: 'lifetime' });
    });

    const selectModel = (who: Person) =>
      t.http().get('/v2/usage-probe/select-model').set('Authorization', who.authorization);

    it('refuse un compte standard en 403 FORBIDDEN, ouvre premium et admin, sans rien compter', async () => {
      const alice = t.signIn('alice@apex.test');
      const paula = t.signIn('paula@apex.test', ['premium']);
      const adam = t.signIn('adam@apex.test', ['admin']);

      const refused = await selectModel(alice);

      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('FORBIDDEN');
      expect((await selectModel(paula)).status).toBe(200);
      expect((await selectModel(adam)).status).toBe(200);
      expect(t.usageLedger.counts.size).toBe(0);
    });

    it('le dit dans GET /v2/usage, action par action', async () => {
      const alice = t.signIn('alice@apex.test');

      await expect(usage(alice)).resolves.toEqual({
        actions: [
          {
            action: SEND,
            access: 'limited',
            quota: 3,
            used: 0,
            remaining: 3,
            period: 'lifetime',
            resetsAt: null,
          },
          { action: 'probe.select-model', access: 'denied' },
        ],
      });
    });

    it('s’ouvre à tous dès que ses lignes disparaissent', async () => {
      const alice = t.signIn('alice@apex.test');
      t.usagePolicies.removeAction('probe.select-model');

      expect((await selectModel(alice)).status).toBe(200);
    });
  });

  it('ne gouverne rien tant qu’aucune politique n’est en vigueur', async () => {
    t = await createTestApp();
    const alice = t.signIn('alice@apex.test');
    const objectiveId = await createObjective(alice);

    for (let i = 0; i < 4; i++) await turn(alice, objectiveId);

    await expect(usage(alice)).resolves.toEqual({ actions: [] });
    expect(t.usageLedger.counts.size).toBe(0);
  });
});
