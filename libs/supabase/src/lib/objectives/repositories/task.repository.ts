import { Task, TaskRepository } from '@org/objective';
import { SupabaseClientDataAccess } from '../../supabase-client';
import { TaskMapper } from '../mapper/task.mapper';

export class SupabaseTaskRepository implements TaskRepository {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  private get db() {
    return this.supabaseClient.clientInstance;
  }

  async getAllUserTasks(userId: string): Promise<Task[]> {
    const { data, error } = await this.db
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at')
      .order('id');

    if (error) {
      throw new Error(`Erreur récupération tâches: ${error.message}`);
    }

    return (data ?? []).map((row) => TaskMapper.toDomain(row));
  }

  async findById(taskId: string, ownerId: string): Promise<Task | null> {
    // `maybeSingle` : un pas introuvable rend `null` (dans Apex, `single` levait et donnait UNKNOWN_ERROR).
    const { data, error } = await this.db
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (error) {
      throw new Error(`Erreur récupération tâche: ${error.message}`);
    }

    return data ? TaskMapper.toDomain(data) : null;
  }

  async update(task: Task, ownerId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('tasks')
      .update(TaskMapper.toPersistence(task))
      .eq('id', task.id)
      .eq('user_id', ownerId)
      .select('id');

    if (error) {
      console.error('Erreur sauvegarde tâche:', error);
      return false;
    }

    return (data?.length ?? 0) === 1;
  }
}
