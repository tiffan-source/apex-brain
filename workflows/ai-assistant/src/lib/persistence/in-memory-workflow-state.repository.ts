import { IWorkflowStateRepository, WorkflowState } from '../model/workflow.model';

/**
 * L'état des workflows en mémoire du processus : pour les tests et le développement local sans
 * Firestore. Tout est perdu au redémarrage. Les états sont copiés en JSON, comme dans un vrai
 * stockage (aucune référence partagée, les dates deviennent des chaînes).
 */
export class InMemoryWorkflowStateRepository extends IWorkflowStateRepository {
  private readonly states = new Map<string, string>();

  /** Nombre d'écritures reçues (utile aux tests). */
  saves = 0;

  async save(state: WorkflowState): Promise<void> {
    this.saves += 1;
    this.states.set(state.id, JSON.stringify(state));
  }

  async findById(id: string): Promise<WorkflowState | null> {
    const stored = this.states.get(id);
    return stored ? (JSON.parse(stored) as WorkflowState) : null;
  }

  /** Remplacer un état tel quel (pour simuler un document écrit par une autre version). */
  async overwrite(state: WorkflowState): Promise<void> {
    this.states.set(state.id, JSON.stringify(state));
  }
}
