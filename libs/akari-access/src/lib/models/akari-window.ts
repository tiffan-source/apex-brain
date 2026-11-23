import { AkariWindow } from './akari-rule';

export type AkariWindowBounds = {
  /** Le début de la fenêtre ; `null` : tout l'historique compte. */
  since: Date | null;
  /** La remise à zéro du compteur ; `null` : jamais. */
  resetsAt: Date | null;
};

/**
 * Les bornes de la fenêtre qui contient `now`. Seule `total` est comptée pour l'instant : `day` et
 * `month` arrivent avec leurs remises à zéro (issue #12) et se comptent d'ici là comme `total`.
 */
export function windowBounds(_window: AkariWindow, _now: Date): AkariWindowBounds {
  return { since: null, resetsAt: null };
}
