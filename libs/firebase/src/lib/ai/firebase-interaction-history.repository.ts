import type { InteractionHistory, InteractionHistoryRepository } from '@org/ai';
import type { DocumentStore } from '../document-store';

const COLLECTION = 'ai-interaction-histories';

/** Le document tel qu'il est stocké : les messages en JSON, à l'abri des limites de Firestore. */
type InteractionHistoryDocument = {
  schemaVersion: 1;
  provider: string;
  messagesJson: string;
  createdAt: string;
};

/**
 * L'historique des interactions dans Firestore, un document par interaction (son id est celui du
 * document). Un document n'est écrit qu'une fois : un historique ne change plus.
 */
export class FirebaseInteractionHistoryRepository implements InteractionHistoryRepository {
  constructor(private readonly firebase: { db: DocumentStore }) {}

  async save(history: InteractionHistory): Promise<void> {
    // Les arguments d'outils choisis par l'IA peuvent contenir des tableaux imbriqués, que Firestore
    // refuse : le JSON les garde intacts.
    const document: InteractionHistoryDocument = {
      schemaVersion: 1,
      provider: history.provider,
      messagesJson: JSON.stringify(history.messages),
      createdAt: history.createdAt,
    };

    await this.firebase.db.collection(COLLECTION).doc(history.interactionId).set(document);
  }

  async findById(interactionId: string): Promise<InteractionHistory | null> {
    const snapshot = await this.firebase.db.collection(COLLECTION).doc(interactionId).get();
    const data = snapshot.exists ? snapshot.data() : undefined;

    if (!data || typeof data['messagesJson'] !== 'string') {
      return null;
    }

    const document = data as unknown as InteractionHistoryDocument;
    return {
      interactionId,
      provider: document.provider,
      messages: JSON.parse(document.messagesJson) as unknown[],
      createdAt: document.createdAt,
    };
  }
}
