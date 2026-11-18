import { AkariUsage } from '../models/akari-usage';

/**
 * Le journal d'usage d'Akari : un tour réussi par entrée, indépendant des objectifs (supprimer un
 * objectif ne rend pas ses messages), conservé indéfiniment.
 */
export abstract class AkariUsageJournal {
  /** Les tours de cette personne depuis `since` (`null` : depuis toujours). */
  abstract countSince(ownerId: string, since: Date | null): Promise<number>;

  /** Enregistrer un tour sous cet id ; un id déjà enregistré ne compte pas deux fois. */
  abstract record(id: string, usage: AkariUsage): Promise<void>;
}
