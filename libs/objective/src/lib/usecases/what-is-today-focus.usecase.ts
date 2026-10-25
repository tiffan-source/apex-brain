import { Result, runWithResult } from '@org/chore';
import { TaskRepository } from '../protocols/task.repository';
import { Task } from '../models/task';

export type WhatIsTodayFocusOutput = {
  id: string;
  title: string;
  objectiveId: string;
  important: number;
  urgent: number;
  dueDate?: Date;
  done: boolean;
}[];

/** Le nombre de pas proposés pour la journée. */
export const TODAY_FOCUS_SIZE = 5;

export class WhatIsTodayFocusUsecase {
  constructor(private readonly repository: TaskRepository) {}

  async execute(userId: string): Promise<Result<WhatIsTodayFocusOutput>> {
    return runWithResult<WhatIsTodayFocusOutput>(
      async () => {
        const tasks = await this.repository.getAllUserTasks(userId);

        return [...tasks]
          .sort(byFocusPriority)
          .slice(0, TODAY_FOCUS_SIZE)
          .map((task) => ({
            id: task.id,
            title: task.title,
            objectiveId: task.objectiveId ?? '',
            important: task.importance,
            urgent: task.urgency,
            dueDate: task.dueDate,
            done: task.done,
          }));
      },
      [],
      'Failed to get today focus tasks',
    );
  }
}

/**
 * Règle du focus : d'abord la somme importance + urgence la plus haute, puis un pas avec échéance
 * avant un pas sans échéance, puis l'échéance la plus proche.
 */
function byFocusPriority(a: Task, b: Task): number {
  const weightA = a.importance + a.urgency;
  const weightB = b.importance + b.urgency;

  if (weightA !== weightB) return weightB - weightA;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
  return 0;
}
