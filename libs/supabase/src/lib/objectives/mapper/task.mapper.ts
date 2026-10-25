import { Task } from '@org/objective';
import { Database } from '../../database.types';

export type TaskRow = Omit<Database['public']['Tables']['tasks']['Row'], 'created_at'>;

/** Les colonnes d'un pas qu'une modification peut changer (ni son propriétaire, ni son objectif). */
export type TaskUpdateRow = Omit<TaskRow, 'objective_id' | 'user_id'>;

export class TaskMapper {
  static toDomain(row: TaskRow): Task {
    const task = new Task(row.id, row.title, row.importance, row.urgency);

    if (row.description) task.setDescription(row.description);
    if (row.due_date) task.setDueDate(new Date(row.due_date));
    task.setObjectiveId(row.objective_id);
    task.setDone(row.done);

    return task;
  }

  static toPersistence(task: Task): TaskUpdateRow {
    return {
      id: task.id,
      title: task.title,
      description: task.description ?? null,
      importance: task.importance,
      urgency: task.urgency,
      due_date: task.dueDate ? task.dueDate.toISOString() : null,
      done: task.done,
    };
  }
}
