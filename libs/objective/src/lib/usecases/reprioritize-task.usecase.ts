import { Result, runWithResult } from '@org/chore';
import { TaskCommandOutput } from '../mappers/command-output.mapper';
import { TaskRepository } from '../protocols/task.repository';
import { editTask, TASK_EDITION_ERRORS } from './edit-task';

export interface ReprioritizeTaskInput {
  taskId: string;
  importance: number;
  urgency: number;
  ownerId: string;
}

/** Revoir l'importance et l'urgence d'un pas (de 1 à 5 ; à partir de 3 : important, urgent). */
export class ReprioritizeTaskUsecase {
  constructor(private readonly repository: TaskRepository) {}

  execute(input: ReprioritizeTaskInput): Promise<Result<TaskCommandOutput>> {
    return runWithResult<TaskCommandOutput>(
      () =>
        editTask(this.repository, input.taskId, input.ownerId, (task) =>
          task.setImportance(input.importance).setUrgency(input.urgency),
        ),
      TASK_EDITION_ERRORS,
      'Failed to reprioritize task',
    );
  }
}
