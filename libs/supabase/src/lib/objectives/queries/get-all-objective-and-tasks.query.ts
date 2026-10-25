import {
  GetAllObjectiveAndTaskInput,
  GetAllObjectiveAndTaskOutput,
  GetAllObjectiveAndTaskQuery,
} from '@org/objective';
import { SupabaseClientDataAccess } from '../../supabase-client';
import { ObjectiveMapper } from '../mapper/objective.mapper';

export class SupabaseGetAllObjectiveAndTaskQuery implements GetAllObjectiveAndTaskQuery {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  async execute(input: GetAllObjectiveAndTaskInput): Promise<GetAllObjectiveAndTaskOutput> {
    const db = this.supabaseClient.clientInstance;

    // Ordre stable (création, puis id) : dans Apex, sans ORDER BY, chaque écriture déplaçait
    // la ligne modifiée en fin de lecture.
    const [objectivesResult, tasksResult] = await Promise.all([
      db.from('objectives').select('*').eq('user_id', input.ownerId).order('created_at').order('id'),
      db.from('tasks').select('*').eq('user_id', input.ownerId).order('created_at').order('id'),
    ]);

    if (objectivesResult.error) {
      throw new Error(`Erreur récupération objectifs: ${objectivesResult.error.message}`);
    }

    if (tasksResult.error) {
      throw new Error(`Erreur récupération tâches: ${tasksResult.error.message}`);
    }

    return {
      objectives: ObjectiveMapper.toObjectiveOutput(objectivesResult.data),
      tasks: ObjectiveMapper.toTaskOutput(tasksResult.data),
    };
  }
}
