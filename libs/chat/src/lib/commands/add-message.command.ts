export type AddMessageCommandInput = {
  id: string;
  message: string;
  /** L'auteur du message : l'id de la personne, ou celui de l'assistant. */
  userId: string;
  conversationId: string;
};

export type AddMessageCommandOutput = {
  id: string;
  message: string;
  createdAt: Date;
};

/**
 * Ajouter un message à une conversation. Rejouer la commande avec le même `id` ne double pas le
 * message : elle rend celui qui est déjà enregistré.
 */
export abstract class AddMessageCommand {
  abstract execute(input: AddMessageCommandInput): Promise<AddMessageCommandOutput>;
}
