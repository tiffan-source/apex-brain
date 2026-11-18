/** « Maintenant », remplaçable dans les tests : il place les fenêtres de quota. */
export abstract class Clock {
  abstract now(): Date;
}
