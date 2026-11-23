import { StoredWorkflowState, WorkflowStateStore } from '../protocols/workflow-state-store';

/**
 * L'état des instances en mémoire du processus : pour les tests et le développement local sans
 * Firestore. Tout est perdu au redémarrage. Les états sont copiés en JSON, comme dans un vrai
 * stockage (aucune référence partagée, les dates deviennent des chaînes).
 */
export class InMemoryWorkflowStateStore<TContext = unknown, TValue = unknown> extends WorkflowStateStore<
  TContext,
  TValue
> {
  private readonly states = new Map<string, string>();

  /** Nombre d'écritures reçues (utile aux tests). */
  saves = 0;

  async save(state: StoredWorkflowState<TContext, TValue>): Promise<void> {
    this.saves += 1;
    this.states.set(state.id, JSON.stringify(state));
  }

  async findById(id: string): Promise<StoredWorkflowState<TContext, TValue> | null> {
    const stored = this.states.get(id);
    return stored ? (JSON.parse(stored) as StoredWorkflowState<TContext, TValue>) : null;
  }

  async delete(id: string): Promise<void> {
    this.states.delete(id);
  }

  /** Remplacer un état tel quel (pour simuler un document écrit par une autre version). */
  async overwrite(state: StoredWorkflowState<TContext, TValue>): Promise<void> {
    this.states.set(state.id, JSON.stringify(state));
  }
}
