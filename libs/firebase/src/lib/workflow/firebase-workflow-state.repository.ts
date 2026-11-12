import type {
  IWorkflowStateRepository,
  WorkflowContext,
  WorkflowState,
  WorkflowStateValue,
} from '@org/ai-assistant';
import type { DocumentStore } from '../document-store';

const COLLECTION = 'workflow-states';

/** Le document tel qu'il est stocké : le contexte et le snapshot en JSON, à l'abri des limites de Firestore. */
type WorkflowStateDocument = {
  schemaVersion: 2;
  value: WorkflowStateValue;
  objectiveId: string;
  userId: string;
  contextJson: string;
  snapshotJson: string | null;
  updatedAt: string;
};

/** Ce qu'Apex écrivait avec le SDK client : la valeur et le contexte à plat. */
type LegacyWorkflowStateDocument = {
  id?: string;
  value: WorkflowStateValue;
  context: WorkflowContext;
};

export class FirebaseWorkflowStateRepository implements IWorkflowStateRepository {
  constructor(private readonly firebase: { db: DocumentStore }) {}

  async save(state: WorkflowState): Promise<void> {
    // Le contexte contient des arguments d'outils choisis par l'IA : des tableaux imbriqués, que
    // Firestore refuse, peuvent s'y trouver. Le JSON les garde intacts.
    const document: WorkflowStateDocument = {
      schemaVersion: 2,
      value: state.value,
      objectiveId: state.context.objectiveId,
      userId: state.context.userId,
      contextJson: JSON.stringify(state.context),
      snapshotJson: state.persistedSnapshot === undefined ? null : JSON.stringify(state.persistedSnapshot),
      updatedAt: state.updatedAt ?? new Date().toISOString(),
    };

    // `set` sans fusion : un ancien document d'Apex est remplacé entièrement.
    await this.firebase.db.collection(COLLECTION).doc(state.id).set(document);
  }

  async delete(id: string): Promise<void> {
    await this.firebase.db.collection(COLLECTION).doc(id).delete();
  }

  async findById(id: string): Promise<WorkflowState | null> {
    const snapshot = await this.firebase.db.collection(COLLECTION).doc(id).get();
    const data = snapshot.exists ? snapshot.data() : undefined;

    if (!data) {
      return null;
    }

    if (typeof data['contextJson'] === 'string') {
      const document = data as unknown as WorkflowStateDocument;
      return {
        id,
        value: document.value,
        context: JSON.parse(document.contextJson) as WorkflowContext,
        persistedSnapshot: document.snapshotJson ? JSON.parse(document.snapshotJson) : undefined,
        updatedAt: document.updatedAt,
      };
    }

    const legacy = data as unknown as LegacyWorkflowStateDocument;
    return { id, value: legacy.value, context: legacy.context };
  }
}
