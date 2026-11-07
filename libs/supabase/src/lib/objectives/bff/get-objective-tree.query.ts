import {
  buildObjectiveTree,
  GetObjectiveTreeInput,
  GetObjectiveTreeOutput,
  GetObjectiveTreeQuery,
} from '@org/objective/bff';
import { SupabaseClientDataAccess } from '../../supabase-client';

/**
 * BFF : l'arbre de tous les objectifs de la personne, lu en deux requêtes filtrées par propriétaire
 * et emboîté ici. `done` est rendu tel qu'il est en base, sans calcul.
 */
export class SupabaseGetObjectiveTreeQuery implements GetObjectiveTreeQuery {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  async execute(input: GetObjectiveTreeInput): Promise<GetObjectiveTreeOutput> {
    const db = this.supabaseClient.clientInstance;

    // Un tri stable (création, puis id), sans valeur métier : l'affichage ne saute pas d'une lecture à l'autre.
    const [objectivesResult, tasksResult] = await Promise.all([
      db
        .from('objectives')
        .select('id, title, description, why, due_date, done, parent_id')
        .eq('user_id', input.ownerId)
        .order('created_at')
        .order('id'),
      db
        .from('tasks')
        .select('id, title, importance, urgency, done, objective_id')
        .eq('user_id', input.ownerId)
        .order('created_at')
        .order('id'),
    ]);

    if (objectivesResult.error) {
      throw new Error(`Erreur récupération objectifs: ${objectivesResult.error.message}`);
    }

    if (tasksResult.error) {
      throw new Error(`Erreur récupération tâches: ${tasksResult.error.message}`);
    }

    return buildObjectiveTree(
      objectivesResult.data.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? '',
        why: row.why ?? '',
        dueDate: row.due_date ? new Date(row.due_date) : null,
        done: row.done,
        parentId: row.parent_id,
      })),
      tasksResult.data.map((row) => ({
        id: row.id,
        title: row.title,
        importance: row.importance,
        urgency: row.urgency,
        done: row.done,
        objectiveId: row.objective_id,
      })),
    );
  }
}
