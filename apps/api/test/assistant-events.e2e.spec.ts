import { Logger } from '@nestjs/common';
import { AIProviderError } from '@org/ai';
import { workflowStateResponseSchema } from '../src/assistant/assistant.schemas';
import type { EventStream, StreamMessage } from './support/event-stream';
import { openEventStream } from './support/event-stream';
import type { TestApp } from './support/test-app';
import { createTestApp } from './support/test-app';

type Person = ReturnType<TestApp['signIn']>;
type State = ReturnType<typeof workflowStateResponseSchema.parse>;

describe("Flux SSE de l'assistant (e2e)", () => {
  let t: TestApp;
  let base: string;
  let alice: Person;
  let mallory: Person;
  let objectiveId: string;
  let streams: EventStream[];
  let closed: boolean;

  const createObjective = async (who: Person, title = 'Courir un marathon') => {
    const created = await t
      .http()
      .post('/v2/objectives')
      .set('Authorization', who.authorization)
      .send({ title });
    expect(created.status).toBe(201);
    return created.body.id as string;
  };

  beforeEach(async () => {
    t = await createTestApp();
    await t.app.listen(0, '127.0.0.1');
    base = await t.app.getUrl();
    streams = [];
    closed = false;
    alice = t.signIn('alice@apex.test');
    mallory = t.signIn('mallory@apex.test');
    objectiveId = await createObjective(alice);
  });

  afterEach(async () => {
    for (const stream of streams) await stream.close();
    if (!closed) await t.close();
  });

  const open = async (who?: Person, id = objectiveId) => {
    const stream = await openEventStream(`${base}/v2/objectives/${id}/assistant/events`, who?.authorization);
    streams.push(stream);
    return stream;
  };

  const send = (message: string, who = alice, id = objectiveId) =>
    t
      .http()
      .post(`/v2/objectives/${id}/assistant/messages`)
      .set('Authorization', who.authorization)
      .send({ message });

  const stateOf = (message: StreamMessage): State => workflowStateResponseSchema.parse(message.data);
  const states = (stream: EventStream) =>
    stream.messages.filter(({ event }) => event === 'state.changed').map(stateOf);

  it("suit un tour en direct : l'état à l'ouverture, chaque étape, puis la réponse d'Akari", async () => {
    const stream = await open(alice);
    expect(stream.status).toBe(200);
    expect(stream.contentType).toContain('text/event-stream');

    const opening = await stream.waitFor(() => true);
    expect(opening.event).toBe('state.changed');
    expect(stateOf(opening)).toMatchObject({ objectiveId, status: 'ready', activity: null });

    t.ai.willRespond(t.ai.text('Bonjour !'));
    expect((await send('Salut')).status).toBe(202);

    const succeeded = await stream.waitFor(({ event }) => event === 'turn.succeeded');
    const final = await stream.waitFor(
      (message) =>
        message.event === 'state.changed' && stateOf(message).lastRegisteredMessage?.sender === 'AI',
    );

    expect(stateOf(final)).toMatchObject({ status: 'ready', activity: null, lastError: null });
    expect(succeeded.data).toEqual({ replyMessageId: stateOf(final).lastRegisteredMessage?.id });
    // Chaque étape passe par le flux, même trop brève pour une interrogation chaque seconde.
    expect(states(stream).map(({ activity }) => activity?.step ?? null)).toEqual([
      null,
      null,
      'saving-message',
      'thinking',
      'saving-reply',
      null,
    ]);
    // Le dernier état est celui que rend la lecture.
    const read = await t
      .http()
      .get(`/v2/objectives/${objectiveId}/assistant`)
      .set('Authorization', alice.authorization);
    expect(final.data).toEqual(read.body);
  });

  it("ne montre à chacun que les événements publics de son objectif, jamais le détail d'une panne", async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const malloryObjective = await createObjective(mallory, 'Objectif de Mallory');
    const otherObjective = await createObjective(alice, 'Un autre objectif');
    const aliceStream = await open(alice);
    const malloryStream = await open(mallory, malloryObjective);
    await aliceStream.waitFor(() => true);
    await malloryStream.waitFor(() => true);

    t.ai.willRespond(t.ai.text('Pour Mallory.'));
    await send('Salut', mallory, malloryObjective);
    await malloryStream.waitFor(({ event }) => event === 'turn.succeeded');

    t.ai.willRespond(t.ai.text('Pour son autre objectif.'));
    await send('Salut', alice, otherObjective);
    await vi.waitFor(async () => {
      const read = await t
        .http()
        .get(`/v2/objectives/${otherObjective}/assistant`)
        .set('Authorization', alice.authorization);
      expect(read.body.lastRegisteredMessage?.sender).toBe('AI');
    });

    t.ai.willRespond(new AIProviderError('clé secrète refusée'));
    await send('Bonjour');
    const failed = await aliceStream.waitFor(
      (message) => message.event === 'state.changed' && stateOf(message).lastError !== null,
    );
    await t.settle();
    logged.mockRestore();

    expect(stateOf(failed).lastError).toEqual({
      code: 'AI_PROVIDER_FAILURE',
      step: 'SendingPromptToAI',
      at: expect.any(String),
    });
    expect(states(aliceStream).every((state) => state.objectiveId === objectiveId)).toBe(true);
    expect(aliceStream.messages.map(({ event }) => event)).not.toContain('turn.succeeded');
    expect(aliceStream.messages.map(({ event }) => event)).not.toContain('turn.failed');
    expect(JSON.stringify(aliceStream.messages)).not.toContain('clé secrète refusée');
    expect(states(malloryStream).every((state) => state.objectiveId === malloryObjective)).toBe(true);
  });

  it("refuse en JSON, avant tout flux : sans jeton (401), pour l'objectif d'une autre personne (404)", async () => {
    const anonymous = await open();
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });

    const intruder = await open(mallory);
    expect(intruder.status).toBe(404);
    expect(intruder.body).toMatchObject({ error: { code: 'CONVERSATION_NOT_FOUND' } });
  });

  it("se désabonne du bus quand le client s'en va", async () => {
    const before = t.bus.subscriberCount;
    const stream = await open(alice);
    await stream.waitFor(() => true);
    expect(t.bus.subscriberCount).toBe(before + 1);

    await stream.close();

    await vi.waitFor(() => expect(t.bus.subscriberCount).toBe(before));
  });

  it("se termine à l'arrêt du serveur, qui n'attend pas que le client s'en aille", async () => {
    const stream = await open(alice);
    await stream.waitFor(() => true);

    closed = true;
    const startedAt = Date.now();
    await Promise.all([t.close(), stream.ended]);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('est décrit dans le document OpenAPI', async () => {
    const document = (await t.http().get('/docs-json')).body;
    const route = document.paths['/v2/objectives/{objectiveId}/assistant/events'].get;

    expect(route.responses['200'].description).toContain('state.changed');
    expect(Object.keys(route.responses)).toEqual(expect.arrayContaining(['200', '404']));
  });
});
