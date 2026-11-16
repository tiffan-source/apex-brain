/**
 * Les actions d'usage de l'assistant, telles que les nomment les politiques (table `usage_actions`, voir
 * docs/adr/0010-politiques-d-usage.md). Un nom est un contrat : il est en base et dans `GET /v2/usage`.
 */
export const ASSISTANT_ACTIONS = {
  /** Envoyer un message à Akari : chaque message lance un tour. */
  sendMessage: 'assistant.send-message',
} as const;
