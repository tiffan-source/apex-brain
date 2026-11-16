import { Role } from '@org/user';

/** Un compteur : une personne, une action, le rôle dont elle utilise le quota, une fenêtre de temps. */
export type UsageCounter = {
  ownerId: string;
  action: string;
  role: Role;
  /** La clé de la fenêtre : `lifetime`, `2026-11-16` ou `2026-11`. */
  window: string;
};

/** Ce que rend une tentative de prise. */
export type TakeResult = {
  /** L'unité est prise : le compteur était sous la limite. */
  taken: boolean;
  /** Le compte après la tentative. */
  used: number;
};

/**
 * Les compteurs d'usage, hors de la base métier : Firestore en production
 * (voir docs/adr/0010-politiques-d-usage.md).
 */
export abstract class UsageLedger {
  /**
   * Prendre une unité si le compteur est sous la limite, en un seul geste : deux prises simultanées ne
   * dépassent jamais la limite.
   */
  abstract take(counter: UsageCounter, limit: number): Promise<TakeResult>;

  /** Rendre une unité ; un compteur à zéro y reste. */
  abstract giveBack(counter: UsageCounter): Promise<void>;

  /** Le compte actuel ; 0 pour un compteur qui n'a jamais servi. */
  abstract used(counter: UsageCounter): Promise<number>;
}

/**
 * L'identifiant stable d'un compteur (l'id de son document Firestore) : ses parties encodées, séparées par `|`.
 * Une partie ne peut donc ni contenir de `/`, interdit dans un id Firestore, ni se confondre avec sa voisine.
 */
export function usageCounterId(counter: UsageCounter): string {
  return [counter.ownerId, counter.action, counter.role, counter.window].map(encodeURIComponent).join('|');
}
