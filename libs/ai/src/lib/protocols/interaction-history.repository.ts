/**
 * Les messages échangés avec l'IA jusqu'à une interaction, elle comprise, au format du fournisseur
 * qui les a écrits. Opaques ici : ils doivent seulement survivre à un aller-retour en JSON.
 */
export type InteractionHistory = {
  /** L'id de l'interaction, celui que le fournisseur a rendu au workflow. */
  interactionId: string;
  /** Le fournisseur qui a écrit cet historique, seul à savoir le relire (`claude`…). */
  provider: string;
  messages: unknown[];
  /** Instant de l'écriture (ISO 8601). */
  createdAt: string;
};

/**
 * L'historique des interactions, pour un fournisseur dont l'API ne garde rien d'un appel à l'autre
 * (l'API Messages de Claude) : il range sous l'id de chaque interaction tout ce qui a été échangé
 * jusqu'à elle, et le relit pour enchaîner la suivante. Gemini, lui, garde cet historique chez lui.
 *
 * Un historique écrit ne change plus : rejouer une étape (un workflow restauré relance l'étape
 * interrompue) repart du même historique et en écrit un nouveau, sans rien perdre ni doubler.
 */
export abstract class InteractionHistoryRepository {
  abstract save(history: InteractionHistory): Promise<void>;

  /** `null` pour une interaction dont l'historique n'a jamais été écrit, ou n'est plus là. */
  abstract findById(interactionId: string): Promise<InteractionHistory | null>;
}
