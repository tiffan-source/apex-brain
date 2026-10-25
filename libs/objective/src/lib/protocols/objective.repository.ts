import { Objective } from '../models/objective';

/**
 * Port de persistance des objectifs.
 *
 * Chaque méthode reçoit le propriétaire : un objectif qui ne lui appartient pas est introuvable
 * (`null`) et ne peut pas être écrasé (voir docs/adr/0002-acces-aux-donnees.md).
 */
export abstract class ObjectiveRepository {
  /**
   * Enregistrer l'objectif, ses pas et tout son sous-arbre chargé.
   * Rend `false` si l'enregistrement n'a pas abouti.
   */
  abstract save(objective: Objective, ownerId: string): Promise<boolean>;

  /** Charger l'objectif avec tout son sous-arbre (étapes et pas). */
  abstract findById(id: string, ownerId: string): Promise<Objective | null>;

  /** Charger l'objectif (ou l'étape) qui porte ce pas, avec ses pas directs. */
  abstract findObjectiveWithASpecificTaskId(taskId: string, ownerId: string): Promise<Objective | null>;
}
