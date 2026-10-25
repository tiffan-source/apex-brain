export type GetConversationsQueryInput = {
  /**
   * La référence externe à laquelle la conversation est rattachée. Aujourd'hui l'id d'un objectif
   * principal, mais `chat` ne connaît pas les objectifs : pour lui, ce n'est qu'une référence.
   */
  externalReferenceId: string;
  /** La personne qui lit : une conversation qui ne lui appartient pas est introuvable. */
  ownerId: string;
  /** `false` : seulement la conversation, sans ses messages. Par défaut : avec. */
  includeMessages?: boolean;
};

export type ConversationMessageOutput = {
  id: string;
  sender: string;
  content: string;
  createdAt: Date;
};

export type GetConversationsQueryOutput = {
  id: string;
  /** Dans l'ordre chronologique. */
  messages: ConversationMessageOutput[];
};

/**
 * La conversation rattachée à une référence, avec ses messages ; `null` si aucune n'existe pour
 * cette personne.
 */
export abstract class GetConversationsQuery {
  abstract execute(input: GetConversationsQueryInput): Promise<GetConversationsQueryOutput | null>;
}
