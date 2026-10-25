import { Objective, ObjectiveRepository } from '@org/objective';
import { SupabaseClientDataAccess } from '../../supabase-client';
import { ObjectiveMapper } from '../mapper/objective.mapper';
import { TaskMapper, TaskRow } from '../mapper/task.mapper';

export class SupabaseObjectiveRepository implements ObjectiveRepository {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  private get db() {
    return this.supabaseClient.clientInstance;
  }

  async findObjectiveWithASpecificTaskId(taskId: string, ownerId: string): Promise<Objective | null> {
    // 1. L'objectif qui porte le pas, avec tous ses pas (complets : dans Apex, `done`,
    //    `description` et `due_date` manquaient, et l'enregistrement les remettait à zéro).
    const { data, error } = await this.db
      .from('tasks')
      .select('objectives (*, tasks (*))')
      .eq('id', taskId)
      .eq('user_id', ownerId)
      .order('created_at', { referencedTable: 'objectives.tasks' })
      .order('id', { referencedTable: 'objectives.tasks' })
      .maybeSingle();

    if (error) {
      throw new Error(`Erreur récupération objectif avec tâche spécifique: ${error.message}`);
    }

    const objectiveData = data?.objectives;
    if (!objectiveData || objectiveData.user_id !== ownerId) {
      return null;
    }

    // 2. Reconstitution de l'objectif et de ses pas directs
    const objective = ObjectiveMapper.fromRowToObjective(objectiveData);
    for (const task of objectiveData.tasks as TaskRow[]) {
      objective.addTask(TaskMapper.toDomain(task));
    }

    return objective;
  }

  async save(objective: Objective, ownerId: string): Promise<boolean> {
    try {
      const { objectives, tasks } = ObjectiveMapper.flatten(objective, ownerId);

      // 1. Jamais d'écriture sur la ligne d'un autre propriétaire : l'upsert remplacerait son `user_id`.
      if (
        await this.touchesForeignRows(
          objectives.map((row) => row.id),
          tasks.map((row) => row.id),
          ownerId,
        )
      ) {
        console.error(
          `Refus d'enregistrer l'objectif ${objective.id} : une ligne appartient à un autre propriétaire.`,
        );
        return false;
      }

      // 2. Sauvegarde des objectifs (dans l'ordre parent -> enfants)
      const { error: objectiveError } = await this.db
        .from('objectives')
        .upsert(objectives, { onConflict: 'id' });

      if (objectiveError) {
        console.error('Erreur lors de la sauvegarde des objectifs:', objectiveError);
        return false;
      }

      // 3. Sauvegarde des tâches (si l'objectif en contient)
      if (tasks.length > 0) {
        const { error: taskError } = await this.db.from('tasks').upsert(tasks, { onConflict: 'id' });

        if (taskError) {
          console.error('Erreur lors de la sauvegarde des tâches:', taskError);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Erreur lors de la sauvegarde de l'objectif:", error);
      return false;
    }
  }

  async findById(id: string, ownerId: string): Promise<Objective | null> {
    // 1. Récupération récursive de l'objectif et de tous ses sous-objectifs, pour ce propriétaire
    const { data: flatObjectives, error: objectiveError } = await this.db
      .rpc('get_objective_subtree', { p_id: id })
      .eq('user_id', ownerId)
      .order('created_at')
      .order('id');

    if (objectiveError) {
      throw new Error(`Erreur récupération sous-arbre: ${objectiveError.message}`);
    }

    if (!flatObjectives || !flatObjectives.some((row) => row.id === id)) {
      return null;
    }

    // 2. Toutes les tâches de l'arbre en une seule requête
    const { data: flatTasks, error: taskError } = await this.db
      .from('tasks')
      .select('*')
      .in(
        'objective_id',
        flatObjectives.map((row) => row.id),
      )
      .eq('user_id', ownerId)
      .order('created_at')
      .order('id');

    if (taskError) {
      throw new Error(`Erreur récupération tâches: ${taskError.message}`);
    }

    // 3. Reconstitution des classes Domaine et de l'arborescence
    return ObjectiveMapper.toDomain(flatObjectives, flatTasks ?? [], id);
  }

  private async touchesForeignRows(
    objectiveIds: string[],
    taskIds: string[],
    ownerId: string,
  ): Promise<boolean> {
    const [objectivesResult, tasksResult] = await Promise.all([
      this.db.from('objectives').select('id').in('id', objectiveIds).neq('user_id', ownerId).limit(1),
      taskIds.length > 0
        ? this.db.from('tasks').select('id').in('id', taskIds).neq('user_id', ownerId).limit(1)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (objectivesResult.error || tasksResult.error) {
      throw new Error(
        `Erreur vérification propriétaire: ${(objectivesResult.error ?? tasksResult.error)?.message ?? ''}`,
      );
    }

    return (objectivesResult.data?.length ?? 0) > 0 || (tasksResult.data?.length ?? 0) > 0;
  }
}
