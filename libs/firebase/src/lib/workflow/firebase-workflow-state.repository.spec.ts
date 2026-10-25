import { WORKFLOW_READY_FOR_NEW_MESSAGE, WorkflowState } from '@org/ai-assistant';
import { DocumentStore, FirebaseWorkflowStateRepository } from './firebase-workflow-state.repository';

/** Une Firestore en mémoire qui, comme la vraie, refuse les tableaux imbriqués. */
class FakeFirestore implements DocumentStore {
  readonly documents = new Map<string, Record<string, unknown>>();

  collection(name: string) {
    return {
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>) => {
          if (containsNestedArray(data)) throw new Error('Nested arrays are not supported');
          this.documents.set(`${name}/${id}`, structuredClone(data));
        },
        get: async () => {
          const data = this.documents.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
        },
      }),
    };
  }
}

function containsNestedArray(value: unknown, insideArray = false): boolean {
  if (Array.isArray(value)) return insideArray || value.some((item) => containsNestedArray(item, true));
  if (value && typeof value === 'object')
    return Object.values(value).some((item) => containsNestedArray(item, false));
  return false;
}

const state = (overrides: Partial<WorkflowState> = {}): WorkflowState => ({
  id: 'o1',
  value: { ExecutingAllTool: 'WaitingForUserPermission' },
  context: {
    userId: 'alice',
    prompt: 'Ajoute un pas',
    aiResponse: null,
    objectiveId: 'o1',
    aiProviderInteractionId: 'interaction-1',
    toolCallResults: [],
    currentToolCall: {
      id: 'call-1',
      name: 'createTask',
      arguments: {
        matrix: [
          [1, 2],
          [3, 4],
        ],
      },
    },
  },
  persistedSnapshot: {
    status: 'active',
    value: { ExecutingAllTool: 'WaitingForUserPermission' },
    children: {},
  },
  updatedAt: '2026-10-25T10:00:00.000Z',
  ...overrides,
});

describe('FirebaseWorkflowStateRepository', () => {
  it('enregistre et relit un état, même avec des tableaux imbriqués dans le contexte', async () => {
    const firestore = new FakeFirestore();
    const repository = new FirebaseWorkflowStateRepository({ db: firestore });

    await repository.save(state());

    await expect(repository.findById('o1')).resolves.toEqual(state());
    expect(firestore.documents.get('workflow-states/o1')).toMatchObject({
      schemaVersion: 2,
      objectiveId: 'o1',
      userId: 'alice',
      value: { ExecutingAllTool: 'WaitingForUserPermission' },
    });
  });

  it('relit un document écrit par Apex et le remplace entièrement à la sauvegarde suivante', async () => {
    const firestore = new FakeFirestore();
    const repository = new FirebaseWorkflowStateRepository({ db: firestore });
    const legacyContext = { userId: 'alice', objectiveId: 'o1', prompt: 'x', toolCallResults: [] };
    await firestore
      .collection('workflow-states')
      .doc('o1')
      .set({ id: 'o1', value: 'SendingPromptToAI', context: legacyContext });

    await expect(repository.findById('o1')).resolves.toEqual({
      id: 'o1',
      value: 'SendingPromptToAI',
      context: legacyContext,
    });

    await repository.save(state({ value: WORKFLOW_READY_FOR_NEW_MESSAGE }));
    expect(firestore.documents.get('workflow-states/o1')).not.toHaveProperty('context');
  });

  it('rend null pour un workflow inconnu', async () => {
    await expect(
      new FirebaseWorkflowStateRepository({ db: new FakeFirestore() }).findById('inconnu'),
    ).resolves.toBeNull();
  });
});
