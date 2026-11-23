/**
 * L'état d'une instance tel qu'il est stocké : lisible (sa valeur et son contexte, pour la console ou un
 * ancien format), et restaurable (le snapshot XState).
 */
export type StoredWorkflowState<TContext = unknown, TValue = unknown> = {
  /** La clé de l'instance (l'objectif, pour l'assistant). */
  id: string;
  value: TValue;
  context: TContext;
  /**
   * Le snapshot XState complet (`actor.getPersistedSnapshot()`), opaque pour le stockage : il contient les
   * étapes en cours, que la restauration relance. Absent des documents d'un ancien format.
   */
  persistedSnapshot?: unknown;
  /** Dernière écriture (ISO 8601). */
  updatedAt?: string;
};

/**
 * Où le runtime garde l'état de ses instances. Implémenté par l'infrastructure (Firestore dans
 * `@org/firebase`), en mémoire pour les tests et le développement.
 */
export abstract class WorkflowStateStore<TContext = unknown, TValue = unknown> {
  abstract save(state: StoredWorkflowState<TContext, TValue>): Promise<void>;
  abstract findById(id: string): Promise<StoredWorkflowState<TContext, TValue> | null>;
  /** Sans effet si cette instance n'a pas d'état stocké. */
  abstract delete(id: string): Promise<void>;
}
