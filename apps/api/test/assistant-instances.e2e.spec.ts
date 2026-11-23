import { InMemoryEventBusCluster } from '@org/event-bus/testing';
import type { ConversationMachine } from '@org/ai-assistant';
import type { WorkflowRuntime } from '@org/workflow-runtime';
import { ASSISTANT_RUNTIME } from '../src/assistant/assistant.module';
import { workflowStateResponseSchema } from '../src/assistant/assistant.schemas';
import { eventBusLogger } from '../src/events/event-bus.logger';
import type { EventStream } from './support/event-stream';
import { openEventStream } from './support/event-stream';
import type { TestApp } from './support/test-app';
import { createTestApp, createTestInfrastructure } from './support/test-app';

/**
 * Deux instances de l'API, comme derrière un équilibreur de charge : la même base, le même état des
 * workflows, et un bus qui les relie comme Redis (docs/adr/0010).
 */
describe("L'assistant sur plusieurs instances (e2e)", () => {
  let first: TestApp;
  let second: TestApp;
  let cluster: InMemoryEventBusCluster;
  let streams: EventStream[];

  beforeEach(async () => {
    const infrastructure = createTestInfrastructure();
    cluster = new InMemoryEventBusCluster();
    first = await createTestApp({}, { infrastructure, bus: cluster.instance(eventBusLogger) });
    second = await createTestApp({}, { infrastructure, bus: cluster.instance(eventBusLogger) });
    await second.app.listen(0, '127.0.0.1');
    streams = [];
  });

  afterEach(async () => {
    for (const stream of streams) await stream.close();
    await first.close();
    await second.close();
  });

  const runtimeOf = (instance: TestApp) =>
    instance.app.get<WorkflowRuntime<ConversationMachine>>(ASSISTANT_RUNTIME);

  it("suit depuis une instance le tour joué sur l'autre, qui ne le compte qu'une fois", async () => {
    // Le journal est partagé : chaque instance qui réagirait au tour y écrirait.
    const recorded = vi.spyOn(first.akariJournal, 'record');
    const alice = first.signIn('alice@apex.test');
    const created = await first
      .http()
      .post('/v2/objectives')
      .set('Authorization', alice.authorization)
      .send({ title: 'Courir un marathon' });
    const objectiveId = created.body.id as string;

    // Le flux est ouvert sur la seconde instance…
    const stream = await openEventStream(
      `${await second.app.getUrl()}/v2/objectives/${objectiveId}/assistant/events`,
      alice.authorization,
    );
    streams.push(stream);
    await stream.waitFor(() => true);

    // … le message part sur la première, où tourne le tour.
    first.ai.willRespond(first.ai.text('Bonjour !'));
    const sent = await first
      .http()
      .post(`/v2/objectives/${objectiveId}/assistant/messages`)
      .set('Authorization', alice.authorization)
      .send({ message: 'Salut' });
    expect(sent.status).toBe(202);

    const succeeded = await stream.waitFor(({ event }) => event === 'turn.succeeded');
    const final = await stream.waitFor(
      ({ event, data }) =>
        event === 'state.changed' &&
        workflowStateResponseSchema.parse(data).lastRegisteredMessage?.sender === 'AI',
    );
    await first.settle();
    await second.settle();
    await cluster.idle();

    const reply = workflowStateResponseSchema.parse(final.data).lastRegisteredMessage;
    expect(succeeded.data).toEqual({ replyMessageId: reply?.id });
    // Les deux instances sont abonnées au comptage : seule celle du tour a réagi.
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveBeenCalledWith(reply?.id, expect.objectContaining({ ownerId: alice.id }));
    // Le workflow n'a vécu que sur la première instance.
    expect(runtimeOf(first).activeCount).toBe(1);
    expect(runtimeOf(second).activeCount).toBe(0);
  });
});
