import { Role } from '@org/user';

/** Les fenêtres de comptage d'un quota : depuis toujours, depuis minuit UTC, depuis le 1ᵉʳ du mois UTC. */
export const AKARI_WINDOWS = ['total', 'day', 'month'] as const;

export type AkariWindow = (typeof AKARI_WINDOWS)[number];

/**
 * Les droits Akari d'un rôle : une limite de messages (`null` : illimité) sur une fenêtre. Un objet
 * plutôt qu'un nombre, pour accueillir plus tard d'autres droits (les modèles autorisés).
 */
export type AkariRule = {
  messageLimit: number | null;
  window: AkariWindow;
};

/** Les règles de certains rôles. Un rôle absent n'a pas de règle : il n'a pas accès à Akari. */
export type AkariRules = Partial<Record<Role, AkariRule>>;

/** Les règles de départ : un essai de 3 messages au total pour `standard`, illimité sinon. */
export const STARTING_AKARI_RULES: Readonly<Record<Role, AkariRule>> = {
  standard: { messageLimit: 3, window: 'total' },
  premium: { messageLimit: null, window: 'total' },
  admin: { messageLimit: null, window: 'total' },
};
