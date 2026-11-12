import {
  InteractionHistory,
  InteractionHistoryRepository,
} from '../protocols/interaction-history.repository';

/**
 * L'historique des interactions en mémoire du processus : pour les tests et le développement local
 * sans Firestore. Tout est perdu au redémarrage. Les historiques sont copiés en JSON, comme dans un
 * vrai stockage (aucune référence partagée).
 */
export class InMemoryInteractionHistoryRepository extends InteractionHistoryRepository {
  private readonly histories = new Map<string, string>();

  async save(history: InteractionHistory): Promise<void> {
    this.histories.set(history.interactionId, JSON.stringify(history));
  }

  async findById(interactionId: string): Promise<InteractionHistory | null> {
    const stored = this.histories.get(interactionId);
    return stored ? (JSON.parse(stored) as InteractionHistory) : null;
  }

  /** Le nombre d'historiques enregistrés (utile aux tests). */
  get size(): number {
    return this.histories.size;
  }
}
