/**
 * BFF — lecture destinée aux clients d'Apex (web et mobile), pas au domaine : ni une commande, ni
 * Akari ne s'en servent (règle de lint). Le module Supabase l'implémente directement
 * (docs/adr/0006-commandes-et-bff.md).
 */

export type GetObjectiveTreeInput = {
  ownerId: string;
};

export type ObjectiveTreeTask = {
  id: string;
  title: string;
  importance: number;
  urgency: number;
  done: boolean;
};

export type ObjectiveTreeNode = {
  id: string;
  title: string;
  description: string;
  why: string;
  dueDate: Date | null;
  /** Tel qu'enregistré en base : rien ne le tient à jour pour l'instant. */
  done: boolean;
  /** Sans ordre : les pas sont indépendants (triés par création pour un affichage stable). */
  tasks: ObjectiveTreeTask[];
  /** Sans ordre : les étapes sont indépendantes (triées par création pour un affichage stable). */
  subObjectives: ObjectiveTreeNode[];
};

export type GetObjectiveTreeOutput = {
  /** Les objectifs principaux de la personne, chacun avec tout son arbre. */
  objectives: ObjectiveTreeNode[];
};

/** Tous les objectifs de la personne en arbre : étapes emboîtées, pas rangés sous qui les porte. */
export abstract class GetObjectiveTreeQuery {
  abstract execute(input: GetObjectiveTreeInput): Promise<GetObjectiveTreeOutput>;
}
