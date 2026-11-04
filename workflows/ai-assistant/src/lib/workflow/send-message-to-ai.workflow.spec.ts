import { AIInteractionResponse, AIProviderError } from '@org/ai';
import { createWorkflowHarness, silentLogger, waitForStatus } from '../testing/workflow.harness';
import {
  AI_SENDER_ID,
  WORKFLOW_AWAITING_PERMISSION,
  WORKFLOW_READY_FOR_NEW_MESSAGE,
} from '../model/workflow.model';
import { initialWorkflowContext } from './machine';

const messagesOf = (harness: ReturnType<typeof createWorkflowHarness>) =>
  [...harness.chat.db.messages.values()].map(({ sender, content }) => ({ sender, content }));

describe('SendMessageToAIWorkflow', () => {
  beforeEach(() => {
    silentLogger.errors.length = 0;
  });

  describe('un tour simple', () => {
    it("enregistre le message, interroge l'IA avec le contexte système et enregistre sa réponse", async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai } = harness;
      ai.willRespond(ai.text('Commence par une sortie de 20 minutes.'));

      const sent = await workflow.sendMessage('o1', 'alice', 'Par où commencer ?');
      expect(sent).toMatchObject({ success: true, data: { status: 'processing' } });

      const state = await waitForStatus(workflow, 'ready');

      expect(messagesOf(harness)).toEqual([
        { sender: 'alice', content: 'Par où commencer ?' },
        { sender: AI_SENDER_ID, content: 'Commence par une sortie de 20 minutes.' },
      ]);
      expect(state).toMatchObject({
        value: WORKFLOW_READY_FOR_NEW_MESSAGE,
        pendingToolCall: null,
        lastError: null,
        lastRegisteredMessage: { sender: AI_SENDER_ID, content: 'Commence par une sortie de 20 minutes.' },
      });
      expect(state.lastRegisteredMessage?.createdAt).toBeInstanceOf(Date);

      const [call] = ai.calls;
      if (call.kind !== 'generateMessage') throw new Error('generateMessage attendu');
      // Le message de la personne part tel quel : l'id de l'objectif est dans les instructions système.
      expect(call.input.prompt).toBe('Par où commencer ?');
      expect(call.input.systemInstruction).toContain('« o1 »');
      expect(call.input.tools?.map((tool) => tool.name)).toEqual([
        'getObjectiveTree',
        'createSubObjective',
        'createTask',
      ]);
    });

    it("enchaîne l'interaction suivante sur la précédente", async () => {
      const { workflow, ai } = createWorkflowHarness();
      ai.willRespond(ai.text('Première réponse.'), ai.text('Deuxième réponse.'));

      await workflow.sendMessage('o1', 'alice', 'Un');
      await waitForStatus(workflow, 'ready');
      await workflow.sendMessage('o1', 'alice', 'Deux');
      await waitForStatus(workflow, 'ready');

      const second = ai.calls[1];
      if (second.kind !== 'generateMessage') throw new Error('generateMessage attendu');
      expect(second.input.previousInteractionId).toBe('interaction-1');
    });

    it("décrit un workflow qui n'a jamais servi sans le créer", async () => {
      const { workflow, workflowStateRepository } = createWorkflowHarness();

      await expect(workflow.getState('o1', 'alice')).resolves.toEqual({
        success: true,
        data: {
          objectiveId: 'o1',
          value: WORKFLOW_READY_FOR_NEW_MESSAGE,
          status: 'ready',
          activity: null,
          pendingToolCall: null,
          lastRegisteredMessage: null,
          lastError: null,
        },
      });
      expect(workflowStateRepository.saves).toBe(0);
      expect(workflow.activeWorkflowCount).toBe(0);
    });
  });

  describe('les outils', () => {
    it('exécute un outil de lecture sans demander, puis renvoie le résultat avec les outils et les instructions', async () => {
      const { workflow, ai } = createWorkflowHarness();
      ai.willRespond(
        ai.toolCalls({ id: 'call-1', name: 'getObjectiveTree', arguments: { id: 'o1' } }),
        ai.text('Ton objectif est vide pour le moment.'),
      );

      await workflow.sendMessage('o1', 'alice', 'Où en suis-je ?');
      await waitForStatus(workflow, 'ready');

      const followUp = ai.calls[1];
      if (followUp.kind !== 'sendToolCallResult') throw new Error('sendToolCallResult attendu');
      expect(followUp.interactionId).toBe('interaction-1');
      expect(followUp.toolCallResult).toEqual([
        {
          id: 'call-1',
          functionName: 'getObjectiveTree',
          result: expect.objectContaining({
            id: 'o1',
            title: 'Courir un marathon',
            subObjectives: [],
            tasks: [],
          }),
        },
      ]);
      // Dans Apex, ni les outils ni les instructions ne repartaient avec les résultats.
      expect(followUp.options?.tools?.map((tool) => tool.name)).toContain('createTask');
      expect(followUp.options?.systemInstruction).toContain('« o1 »');
    });

    it("attend l'accord de la personne avant d'écrire, puis écrit pour elle", async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai, objectives } = harness;
      ai.willRespond(
        ai.toolCalls({
          id: 'call-1',
          name: 'createTask',
          arguments: { objectiveId: 'o1', title: 'Courir 5 km', importance: 4, urgency: 2 },
        }),
        ai.text("C'est ajouté."),
      );

      await workflow.sendMessage('o1', 'alice', 'Ajoute un pas');
      const waiting = await waitForStatus(workflow, 'awaiting-permission');

      expect(waiting.value).toEqual(WORKFLOW_AWAITING_PERMISSION);
      expect(waiting.pendingToolCall).toEqual({
        id: 'call-1',
        name: 'createTask',
        arguments: { objectiveId: 'o1', title: 'Courir 5 km', importance: 4, urgency: 2 },
      });
      expect(objectives.db.tasks.size).toBe(0);

      await expect(workflow.respondToPermission('o1', 'alice', true, 'call-1')).resolves.toMatchObject({
        success: true,
      });
      await waitForStatus(workflow, 'ready');

      expect([...objectives.db.tasks.values()]).toEqual([
        expect.objectContaining({ title: 'Courir 5 km', objectiveId: 'o1', ownerId: 'alice', importance: 4 }),
      ]);
      const followUp = ai.calls[1];
      if (followUp.kind !== 'sendToolCallResult') throw new Error('sendToolCallResult attendu');
      expect(followUp.toolCallResult[0].result).toMatchObject({ success: true, title: 'Courir 5 km' });
    });

    it("transmet le refus à l'IA sans rien écrire", async () => {
      const { workflow, ai, objectives } = createWorkflowHarness();
      ai.willRespond(
        ai.toolCalls({
          id: 'call-1',
          name: 'createSubObjective',
          arguments: { parentObjectiveId: 'o1', title: 'Étape' },
        }),
        ai.text("D'accord, on n'ajoute rien."),
      );

      await workflow.sendMessage('o1', 'alice', 'Propose une étape');
      await waitForStatus(workflow, 'awaiting-permission');
      await workflow.respondToPermission('o1', 'alice', false);
      await waitForStatus(workflow, 'ready');

      expect(objectives.db.objectives.size).toBe(2);
      const followUp = ai.calls[1];
      if (followUp.kind !== 'sendToolCallResult') throw new Error('sendToolCallResult attendu');
      expect(followUp.toolCallResult).toEqual([
        {
          id: 'call-1',
          functionName: 'createSubObjective',
          result: 'User denied permission to execute the tool',
        },
      ]);
    });

    it("refuse un outil inconnu et renvoie des arguments invalides à l'IA pour qu'elle se corrige", async () => {
      const { workflow, ai } = createWorkflowHarness();
      ai.willRespond(
        ai.toolCalls(
          { id: 'call-1', name: 'deleteEverything', arguments: {} },
          { id: 'call-2', name: 'getObjectiveTree', arguments: { identifiant: 'o1' } },
        ),
        ai.text('Je ne peux pas faire ça.'),
      );

      await workflow.sendMessage('o1', 'alice', 'Fais le ménage');
      await waitForStatus(workflow, 'ready');

      const followUp = ai.calls[1];
      if (followUp.kind !== 'sendToolCallResult') throw new Error('sendToolCallResult attendu');
      expect(followUp.toolCallResult).toEqual([
        {
          id: 'call-1',
          functionName: 'deleteEverything',
          result: 'Tool execution denied: Tool deleteEverything is not registered',
        },
        {
          id: 'call-2',
          functionName: 'getObjectiveTree',
          result: { error: 'INVALID_ARGUMENTS', issues: [expect.objectContaining({ path: 'id' })] },
        },
      ]);
    });

    it("n'écrit jamais sous l'objectif d'une autre personne, même si l'IA en donne l'id", async () => {
      const { workflow, ai, objectives } = createWorkflowHarness();
      ai.willRespond(
        ai.toolCalls({
          id: 'call-1',
          name: 'createSubObjective',
          arguments: { parentObjectiveId: 'm1', title: 'Intrusion' },
        }),
        ai.text('Impossible.'),
      );

      await workflow.sendMessage('o1', 'alice', 'Ajoute une étape à m1');
      await waitForStatus(workflow, 'awaiting-permission');
      await workflow.respondToPermission('o1', 'alice', true);
      await waitForStatus(workflow, 'ready');

      expect([...objectives.db.objectives.keys()]).toEqual(['o1', 'm1']);
      const followUp = ai.calls[1];
      if (followUp.kind !== 'sendToolCallResult') throw new Error('sendToolCallResult attendu');
      expect(followUp.toolCallResult[0].result).toMatchObject({ success: false });
    });

    it("n'envoie à l'IA que les résultats de sa dernière série d'outils", async () => {
      const { workflow, ai } = createWorkflowHarness();
      ai.willRespond(
        ai.toolCalls({ id: 'call-1', name: 'getObjectiveTree', arguments: { id: 'o1' } }),
        ai.toolCalls({ id: 'call-2', name: 'getObjectiveTree', arguments: { id: 'o1' } }),
        ai.text('Vu deux fois.'),
      );

      await workflow.sendMessage('o1', 'alice', 'Regarde bien');
      await waitForStatus(workflow, 'ready');

      const [, first, second] = ai.calls;
      if (first.kind !== 'sendToolCallResult' || second.kind !== 'sendToolCallResult')
        throw new Error('résultats attendus');
      expect(first.toolCallResult.map((result) => result.id)).toEqual(['call-1']);
      expect(second.toolCallResult.map((result) => result.id)).toEqual(['call-2']);
      expect(second.interactionId).toBe('interaction-2');
    });
  });

  describe("ce que fait l'assistant, dit aux clients", () => {
    /** Une réponse de l'IA que le test donne quand il veut : le tour reste sur cette étape jusque-là. */
    const heldAnswer = () => {
      let answer: (response: AIInteractionResponse) => void = () => undefined;
      const held = () => new Promise<AIInteractionResponse>((resolve) => (answer = resolve));
      return { held, answer: (response: AIInteractionResponse) => answer(response) };
    };

    const activityOf = async (workflow: ReturnType<typeof createWorkflowHarness>['workflow']) => {
      const state = await workflow.getState('o1', 'alice');
      if (!state.success) throw new Error("l'état n'a pas pu être lu");
      return state.data.activity;
    };

    const readObjective = { id: 'call-1', name: 'getObjectiveTree', arguments: { id: 'o1' } };
    const addTask = {
      id: 'call-1',
      name: 'createTask',
      arguments: { objectiveId: 'o1', title: 'Courir 5 km', importance: 4, urgency: 2 },
    };

    it("dit chaque étape d'un tour, même celles trop brèves pour une interrogation chaque seconde", async () => {
      const { workflow, ai } = createWorkflowHarness();
      const first = heldAnswer();
      const second = heldAnswer();
      ai.willRespond(first.held, second.held);

      const sent = await workflow.sendMessage('o1', 'alice', 'Où en suis-je ?');
      expect(sent).toMatchObject({
        success: true,
        data: { activity: { step: 'saving-message', round: 0, done: [] } },
      });

      await vi.waitFor(() => expect(ai.calls).toHaveLength(1));
      await expect(activityOf(workflow)).resolves.toMatchObject({
        step: 'thinking',
        round: 1,
        done: ['saving-message'],
      });

      first.answer(ai.toolCalls(readObjective));
      await vi.waitFor(() => expect(ai.calls).toHaveLength(2));
      await expect(activityOf(workflow)).resolves.toMatchObject({
        step: 'reviewing',
        round: 2,
        done: ['saving-message', 'thinking', 'checking-permission', 'reading'],
      });

      second.answer(ai.text('Ton objectif est vide.'));
      await expect(waitForStatus(workflow, 'ready')).resolves.toMatchObject({ activity: null });
    });

    it("compte chaque tour de boucle : un nouveau passage par l'IA après chaque série d'outils", async () => {
      const { workflow, ai } = createWorkflowHarness();
      const third = heldAnswer();
      ai.willRespond(
        ai.toolCalls(readObjective),
        ai.toolCalls({ ...readObjective, id: 'call-2' }),
        third.held,
      );

      await workflow.sendMessage('o1', 'alice', 'Regarde encore');
      await vi.waitFor(() => expect(ai.calls).toHaveLength(3));

      await expect(activityOf(workflow)).resolves.toMatchObject({
        step: 'reviewing',
        round: 3,
        done: [
          'saving-message',
          'thinking',
          'checking-permission',
          'reading',
          'reviewing',
          'checking-permission',
          'reading',
        ],
      });

      third.answer(ai.text('Vu.'));
      await waitForStatus(workflow, 'ready');
    });

    it("distingue l'attente d'un accord de l'écriture acceptée", async () => {
      const { workflow, ai } = createWorkflowHarness();
      const review = heldAnswer();
      ai.willRespond(ai.toolCalls(addTask), review.held);

      await workflow.sendMessage('o1', 'alice', 'Ajoute un pas');
      await expect(waitForStatus(workflow, 'awaiting-permission')).resolves.toMatchObject({
        activity: {
          step: 'awaiting-permission',
          round: 1,
          done: ['saving-message', 'thinking', 'checking-permission'],
        },
      });

      await expect(workflow.respondToPermission('o1', 'alice', true)).resolves.toMatchObject({
        success: true,
        data: { activity: { step: 'writing' } },
      });

      await vi.waitFor(() => expect(ai.calls).toHaveLength(2));
      await expect(activityOf(workflow)).resolves.toMatchObject({
        step: 'reviewing',
        round: 2,
        done: ['saving-message', 'thinking', 'checking-permission', 'awaiting-permission', 'writing'],
      });

      review.answer(ai.text('Ajouté.'));
      await waitForStatus(workflow, 'ready');
    });

    it("mesure le temps passé sur l'étape en cours avec l'horloge du serveur", async () => {
      const harness = createWorkflowHarness();
      let time = Date.parse('2026-11-02T10:00:00.000Z');
      harness.deps.now = () => new Date(time);
      const workflow = harness.restart();
      const { held, answer } = heldAnswer();
      harness.ai.willRespond(held);

      await workflow.sendMessage('o1', 'alice', 'Question');
      await vi.waitFor(() => expect(harness.ai.calls).toHaveLength(1));

      time += 42_000;

      await expect(activityOf(workflow)).resolves.toMatchObject({ step: 'thinking', elapsedMs: 42_000 });

      answer(harness.ai.text('Réponse.'));
      await waitForStatus(workflow, 'ready');
    });

    it("garde l'écriture dans le journal quand l'outil la refuse : le journal dit ce qui a eu lieu", async () => {
      const { workflow, ai, objectives } = createWorkflowHarness();
      const review = heldAnswer();
      const refused = { ...addTask, arguments: { ...addTask.arguments, importance: 99 } };
      ai.willRespond(ai.toolCalls(refused), review.held);

      await workflow.sendMessage('o1', 'alice', 'Ajoute un pas');
      await waitForStatus(workflow, 'awaiting-permission');
      await workflow.respondToPermission('o1', 'alice', true);
      await vi.waitFor(() => expect(ai.calls).toHaveLength(2));

      await expect(activityOf(workflow)).resolves.toMatchObject({
        step: 'reviewing',
        done: ['saving-message', 'thinking', 'checking-permission', 'awaiting-permission', 'writing'],
      });
      expect(objectives.db.tasks.size).toBe(0);

      review.answer(ai.text("Je n'ai pas pu l'ajouter."));
      await waitForStatus(workflow, 'ready');
    });

    it('ne nomme ni les outils, ni le modèle, ni les états de la machine', async () => {
      const { workflow, ai } = createWorkflowHarness();
      const { held, answer } = heldAnswer();
      ai.willRespond(ai.toolCalls(readObjective), held);

      await workflow.sendMessage('o1', 'alice', 'Regarde');
      await vi.waitFor(() => expect(ai.calls).toHaveLength(2));

      const activity = await activityOf(workflow);
      expect(Object.keys(activity ?? {}).sort()).toEqual(['done', 'elapsedMs', 'round', 'step']);
      expect(JSON.stringify(activity)).not.toMatch(
        /getObjectiveTree|gemini|ExecutingAllTool|SendingCallResultToAI/i,
      );

      answer(ai.text('Vu.'));
      await waitForStatus(workflow, 'ready');
    });

    it("n'a plus d'activité quand une panne arrête le tour, et repart de zéro au message suivant", async () => {
      const { workflow, ai } = createWorkflowHarness();
      ai.willRespond(ai.toolCalls(readObjective), new AIProviderError('quota'));

      await workflow.sendMessage('o1', 'alice', 'Regarde');
      await expect(waitForStatus(workflow, 'ready')).resolves.toMatchObject({
        activity: null,
        lastError: { code: 'AI_PROVIDER_FAILURE' },
      });

      await expect(workflow.sendMessage('o1', 'alice', 'Encore')).resolves.toMatchObject({
        success: true,
        data: { activity: { step: 'saving-message', round: 0, done: [] } },
      });
    });

    it('garde son journal à travers un redémarrage', async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai } = harness;
      ai.willRespond(ai.toolCalls(addTask), ai.text('Ajouté.'));

      await workflow.sendMessage('o1', 'alice', 'Ajoute un pas');
      await waitForStatus(workflow, 'awaiting-permission');
      await workflow.shutdown();

      const restarted = harness.restart();

      await expect(activityOf(restarted)).resolves.toMatchObject({
        step: 'awaiting-permission',
        round: 1,
        done: ['saving-message', 'thinking', 'checking-permission'],
      });
      await restarted.respondToPermission('o1', 'alice', true);
      await waitForStatus(restarted, 'ready');
    });

    it("n'a plus d'activité quand un tour persisté ne peut pas reprendre", async () => {
      const harness = createWorkflowHarness();
      const interrupted = {
        ...initialWorkflowContext(),
        userId: 'alice',
        objectiveId: 'o1',
        activity: [{ step: 'thinking' as const, at: '2026-11-02T10:00:00.000Z' }],
      };
      await harness.workflowStateRepository.overwrite({
        id: 'o1',
        value: 'SendingPromptToAI',
        context: interrupted,
      });

      await expect(harness.workflow.getState('o1', 'alice')).resolves.toMatchObject({
        success: true,
        data: { status: 'ready', activity: null, lastError: { code: 'TURN_INTERRUPTED' } },
      });
    });

    it("reprend un workflow persisté avant l'arrivée du journal", async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai, workflowStateRepository, objectives } = harness;
      ai.willRespond(ai.toolCalls(addTask), ai.text('Ajouté.'));

      await workflow.sendMessage('o1', 'alice', 'Ajoute un pas');
      await waitForStatus(workflow, 'awaiting-permission');
      await workflow.shutdown();

      const stored = await workflowStateRepository.findById('o1');
      if (!stored) throw new Error('un état persisté était attendu');
      delete stored.context.activity;
      delete (stored.persistedSnapshot as { context: { activity?: unknown } }).context.activity;
      await workflowStateRepository.overwrite(stored);

      const restarted = harness.restart();
      await expect(activityOf(restarted)).resolves.toBeNull();

      await expect(restarted.respondToPermission('o1', 'alice', true)).resolves.toMatchObject({
        success: true,
        data: { activity: { step: 'writing', done: [] } },
      });
      await waitForStatus(restarted, 'ready');
      expect(objectives.db.tasks.size).toBe(1);
    });
  });

  describe('les pannes', () => {
    it("revient au repos avec la panne quand l'IA ne répond pas, et accepte un nouveau message", async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai } = harness;
      ai.willRespond(new AIProviderError('quota exceeded'), ai.text('Me revoilà.'));

      await workflow.sendMessage('o1', 'alice', 'Tu es là ?');
      const failed = await waitForStatus(workflow, 'ready');

      expect(failed.lastError).toEqual({
        code: 'AI_PROVIDER_FAILURE',
        step: 'SendingPromptToAI',
        at: expect.any(String),
      });
      // PRD § 8 : le message de la personne est enregistré avant l'appel à l'IA, il reste.
      expect(messagesOf(harness)).toEqual([{ sender: 'alice', content: 'Tu es là ?' }]);

      await workflow.sendMessage('o1', 'alice', 'Et maintenant ?');
      const recovered = await waitForStatus(workflow, 'ready');
      expect(recovered.lastError).toBeNull();
      expect(recovered.lastRegisteredMessage?.content).toBe('Me revoilà.');
    });

    it('revient au repos quand le message ne peut pas être enregistré', async () => {
      const { workflow, chat, ai } = createWorkflowHarness();
      chat.db.failWrites = true;

      await workflow.sendMessage('o1', 'alice', 'Bonjour');
      const state = await waitForStatus(workflow, 'ready');

      expect(state.lastError).toMatchObject({
        code: 'UNKNOWN_ERROR',
        step: 'RegisteringUserMessageInConversation',
      });
      expect(ai.calls).toHaveLength(0);
    });
  });

  describe("l'accès", () => {
    it("refuse un message pendant qu'un tour est en cours", async () => {
      const { workflow, ai } = createWorkflowHarness();
      ai.willRespond(
        ai.toolCalls({
          id: 'call-1',
          name: 'createTask',
          arguments: { objectiveId: 'o1', title: 'X', importance: 1, urgency: 1 },
        }),
      );

      await workflow.sendMessage('o1', 'alice', 'Un');
      await waitForStatus(workflow, 'awaiting-permission');

      await expect(workflow.sendMessage('o1', 'alice', 'Deux')).resolves.toMatchObject({
        success: false,
        error: { code: 'WORKFLOW_BUSY' },
      });
    });

    it("refuse une réponse quand aucun outil n'attend, ou pour un autre outil", async () => {
      const { workflow, ai } = createWorkflowHarness();

      await expect(workflow.respondToPermission('o1', 'alice', true)).resolves.toMatchObject({
        success: false,
        error: { code: 'NO_PENDING_PERMISSION' },
      });

      ai.willRespond(
        ai.toolCalls({
          id: 'call-1',
          name: 'createTask',
          arguments: { objectiveId: 'o1', title: 'X', importance: 1, urgency: 1 },
        }),
      );
      await workflow.sendMessage('o1', 'alice', 'Ajoute');
      await waitForStatus(workflow, 'awaiting-permission');

      await expect(workflow.respondToPermission('o1', 'alice', true, 'call-ancien')).resolves.toMatchObject({
        success: false,
        error: { code: 'NO_PENDING_PERMISSION' },
      });
    });

    it("ne laisse personne lire ou écrire dans la conversation d'un autre", async () => {
      const { workflow, ai } = createWorkflowHarness();
      ai.willRespond(ai.text('Salut Alice.'));
      await workflow.sendMessage('o1', 'alice', 'Salut');
      await waitForStatus(workflow, 'ready');

      for (const attempt of [
        workflow.getState('o1', 'mallory'),
        workflow.startWorkFlow('o1', 'mallory'),
        workflow.sendMessage('o1', 'mallory', 'Coucou'),
        workflow.respondToPermission('o1', 'mallory', true),
      ]) {
        await expect(attempt).resolves.toMatchObject({
          success: false,
          error: { code: 'CONVERSATION_NOT_FOUND' },
        });
      }
    });

    it('signale CONVERSATION_NOT_FOUND pour un objectif sans conversation', async () => {
      const { workflow } = createWorkflowHarness();

      await expect(workflow.sendMessage('inconnu', 'alice', 'Hé')).resolves.toMatchObject({
        success: false,
        error: { code: 'CONVERSATION_NOT_FOUND' },
      });
    });
  });

  describe('la persistance', () => {
    it('reprend après un redémarrage un workflow qui attendait un accord', async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai, objectives } = harness;
      ai.willRespond(
        ai.toolCalls({
          id: 'call-1',
          name: 'createTask',
          arguments: { objectiveId: 'o1', title: 'Reprendre', importance: 3, urgency: 3 },
        }),
        ai.text('Ajouté après la reprise.'),
      );

      await workflow.sendMessage('o1', 'alice', 'Ajoute');
      await waitForStatus(workflow, 'awaiting-permission');
      await workflow.shutdown();

      const restarted = harness.restart();
      const restored = await restarted.getState('o1', 'alice');
      expect(restored).toMatchObject({
        success: true,
        data: { status: 'awaiting-permission', pendingToolCall: { id: 'call-1' } },
      });

      await restarted.respondToPermission('o1', 'alice', true);
      const done = await waitForStatus(restarted, 'ready');

      expect(done.lastRegisteredMessage?.content).toBe('Ajouté après la reprise.');
      expect([...objectives.db.tasks.values()].map((task) => task.title)).toEqual(['Reprendre']);
    });

    it("relance l'étape interrompue par un redémarrage, sans doubler le message", async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai } = harness;
      // L'IA ne répond jamais au premier processus : le serveur s'arrête pendant l'appel.
      ai.willRespond(() => new Promise(() => undefined), ai.text('Réponse après la reprise.'));

      await workflow.sendMessage('o1', 'alice', 'Question');
      await vi.waitFor(() => expect(ai.calls).toHaveLength(1));
      await workflow.shutdown();

      const restarted = harness.restart();
      await restarted.getState('o1', 'alice');
      const done = await waitForStatus(restarted, 'ready');

      expect(done.lastRegisteredMessage?.content).toBe('Réponse après la reprise.');
      expect(ai.calls).toHaveLength(2);
      expect(messagesOf(harness)).toEqual([
        { sender: 'alice', content: 'Question' },
        { sender: AI_SENDER_ID, content: 'Réponse après la reprise.' },
      ]);
    });

    it("reprend l'enregistrement d'un message interrompu sans le doubler", async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai, chat } = harness;
      ai.willRespond(ai.text('Bien reçu.'));

      // L'écriture du message est faite en base, mais le serveur s'arrête avant d'en recevoir la réponse.
      const original = chat.addMessageCommand.execute.bind(chat.addMessageCommand);
      let interrupt = true;
      vi.spyOn(chat.addMessageCommand, 'execute').mockImplementation(async (input) => {
        const saved = await original(input);
        if (interrupt) {
          interrupt = false;
          return new Promise(() => undefined);
        }
        return saved;
      });

      await workflow.sendMessage('o1', 'alice', 'Une seule fois');
      await vi.waitFor(() => expect(chat.db.messages.size).toBe(1));
      await workflow.shutdown();

      const restarted = harness.restart();
      await restarted.getState('o1', 'alice');
      await waitForStatus(restarted, 'ready');

      expect(messagesOf(harness)).toEqual([
        { sender: 'alice', content: 'Une seule fois' },
        { sender: AI_SENDER_ID, content: 'Bien reçu.' },
      ]);
    });

    it('lit un document écrit par Apex : au repos il reprend, en plein tour il revient au repos', async () => {
      const harness = createWorkflowHarness();
      const legacyContext = {
        userId: 'alice',
        prompt: 'Ancienne question',
        aiResponse: {},
        objectiveId: 'o1',
        aiProviderInteractionId: 'interaction-legacy',
        toolCallResults: [],
      };
      await harness.workflowStateRepository.overwrite({
        id: 'o1',
        value: 'SendingPromptToAI',
        context: legacyContext as never,
      });

      const state = await harness.workflow.getState('o1', 'alice');

      expect(state).toMatchObject({
        success: true,
        data: { status: 'ready', lastError: { code: 'TURN_INTERRUPTED', step: 'SendingPromptToAI' } },
      });

      harness.ai.willRespond(harness.ai.text('Nouvelle réponse.'));
      await harness.workflow.sendMessage('o1', 'alice', 'Nouvelle question');
      await waitForStatus(harness.workflow, 'ready');
      const call = harness.ai.calls[0];
      if (call.kind !== 'generateMessage') throw new Error('generateMessage attendu');
      expect(call.input.previousInteractionId).toBe('interaction-legacy');
    });

    it("refuse un état persisté qui appartient à quelqu'un d'autre", async () => {
      const harness = createWorkflowHarness();
      await harness.workflowStateRepository.overwrite({
        id: 'o1',
        value: WORKFLOW_READY_FOR_NEW_MESSAGE,
        context: { userId: 'mallory' } as never,
      });

      await expect(harness.workflow.getState('o1', 'alice')).resolves.toMatchObject({
        success: false,
        error: { code: 'CONVERSATION_NOT_FOUND' },
      });
    });

    it('persiste les transitions dans leur ordre, même quand le stockage est lent', async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai, workflowStateRepository } = harness;
      const save = workflowStateRepository.save.bind(workflowStateRepository);
      let delay = 30;
      vi.spyOn(workflowStateRepository, 'save').mockImplementation(async (state) => {
        // Les premières écritures sont les plus lentes : sans file, elles finiraient en dernier.
        delay = Math.max(0, delay - 10);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return save(state);
      });
      ai.willRespond(ai.text('Ordre respecté.'));

      await workflow.sendMessage('o1', 'alice', 'Test');
      await waitForStatus(workflow, 'ready');
      await workflow.shutdown();

      const persisted = await workflowStateRepository.findById('o1');
      expect(persisted?.value).toBe(WORKFLOW_READY_FOR_NEW_MESSAGE);
      expect(persisted?.context.lastRegisteredMessage?.content).toBe('Ordre respecté.');
    });

    it('libère la mémoire des workflows au repos, puis les restaure au besoin', async () => {
      const harness = createWorkflowHarness({ idleTimeoutMs: 1000 });
      const { workflow, ai } = harness;
      ai.willRespond(ai.text('Avant la pause.'));

      await workflow.sendMessage('o1', 'alice', 'Bonjour');
      await waitForStatus(workflow, 'ready');

      await expect(workflow.evictIdle(Date.now())).resolves.toEqual([]);
      await expect(workflow.evictIdle(Date.now() + 5000)).resolves.toEqual(['o1']);
      expect(workflow.activeWorkflowCount).toBe(0);

      const restored = await workflow.getState('o1', 'alice');
      expect(restored).toMatchObject({
        success: true,
        data: { lastRegisteredMessage: { content: 'Avant la pause.' } },
      });
      expect(workflow.activeWorkflowCount).toBe(1);
    });
  });

  describe("la suppression de l'objectif", () => {
    it("oublie le workflow : plus d'acteur, plus d'état persisté, plus d'accès", async () => {
      const { workflow, ai, chat, workflowStateRepository } = createWorkflowHarness();
      ai.willRespond(ai.text('Bonjour.'));
      await workflow.sendMessage('o1', 'alice', 'Salut');
      await waitForStatus(workflow, 'ready');
      await expect(workflowStateRepository.findById('o1')).resolves.not.toBeNull();

      chat.db.deleteConversation('o1');
      await workflow.forget('o1');

      expect(workflow.activeWorkflowCount).toBe(0);
      await expect(workflowStateRepository.findById('o1')).resolves.toBeNull();
      await expect(workflow.getState('o1', 'alice')).resolves.toMatchObject({
        success: false,
        error: { code: 'CONVERSATION_NOT_FOUND' },
      });
    });

    it("oublie aussi un workflow qui n'est plus en mémoire", async () => {
      const { workflow, ai, workflowStateRepository } = createWorkflowHarness();
      ai.willRespond(ai.text('Bonjour.'));
      await workflow.sendMessage('o1', 'alice', 'Salut');
      await waitForStatus(workflow, 'ready');
      await workflow.shutdown();
      await expect(workflowStateRepository.findById('o1')).resolves.not.toBeNull();

      await workflow.forget('o1');

      await expect(workflowStateRepository.findById('o1')).resolves.toBeNull();
    });

    it("arrête un tour en cours : la réponse de l'IA n'écrit plus rien", async () => {
      const harness = createWorkflowHarness();
      const { workflow, ai, chat, workflowStateRepository } = harness;
      let answer: (response: AIInteractionResponse) => void = () => undefined;
      ai.willRespond(() => new Promise((resolve) => (answer = resolve)));

      await workflow.sendMessage('o1', 'alice', 'Question');
      await vi.waitFor(() => expect(ai.calls).toHaveLength(1));

      chat.db.deleteConversation('o1');
      await workflow.forget('o1');
      answer(ai.text('Trop tard.'));
      await new Promise((resolve) => setTimeout(resolve, 20));

      await expect(workflowStateRepository.findById('o1')).resolves.toBeNull();
      expect(messagesOf(harness)).toEqual([]);
      expect(silentLogger.errors).toEqual([]);
    });

    it("attend les sauvegardes déjà parties : aucune ne recrée l'état", async () => {
      const { workflow, ai, workflowStateRepository } = createWorkflowHarness();
      const save = workflowStateRepository.save.bind(workflowStateRepository);
      vi.spyOn(workflowStateRepository, 'save').mockImplementation(async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return save(state);
      });
      ai.willRespond(ai.text('Réponse.'));

      await workflow.sendMessage('o1', 'alice', 'Question');
      await waitForStatus(workflow, 'ready');
      await workflow.forget('o1');
      await new Promise((resolve) => setTimeout(resolve, 60));

      await expect(workflowStateRepository.findById('o1')).resolves.toBeNull();
    });

    it('ne touche pas au workflow des autres objectifs', async () => {
      const { workflow, ai, workflowStateRepository } = createWorkflowHarness();
      ai.willRespond(ai.text('Bonjour Mallory.'));
      await workflow.sendMessage('m1', 'mallory', 'Salut');
      await waitForStatus(workflow, 'ready', 'm1', 'mallory');

      await workflow.forget('o1');

      expect(workflow.activeWorkflowCount).toBe(1);
      await expect(workflowStateRepository.findById('m1')).resolves.not.toBeNull();
    });

    it('journalise une panne du stockage sans la remonter', async () => {
      const { workflow, workflowStateRepository } = createWorkflowHarness();
      const failure = new Error('Firestore indisponible');
      vi.spyOn(workflowStateRepository, 'delete').mockRejectedValueOnce(failure);

      await expect(workflow.forget('o1')).resolves.toBeUndefined();

      expect(silentLogger.errors).toEqual([failure]);
    });
  });
});
