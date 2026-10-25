import { createInMemoryObjectiveInfrastructure, seedObjective, seedTask } from '../../testing';
import { WhatIsTodayFocusUsecase } from './what-is-today-focus.usecase';

describe('WhatIsTodayFocusUsecase', () => {
  it('garde les cinq pas les plus importants et urgents, puis les échéances les plus proches', async () => {
    const { db, taskRepository } = createInMemoryObjectiveInfrastructure();
    seedObjective(db, { id: 'o1', ownerId: 'alice' });
    seedObjective(db, { id: 's1', ownerId: 'alice', parentId: 'o1' });
    seedTask(db, { id: 'low', ownerId: 'alice', objectiveId: 'o1', importance: 1, urgency: 1 });
    seedTask(db, { id: 'top', ownerId: 'alice', objectiveId: 's1', importance: 5, urgency: 5 });
    seedTask(db, {
      id: 'late',
      ownerId: 'alice',
      objectiveId: 'o1',
      importance: 4,
      urgency: 3,
      dueDate: new Date('2027-06-01'),
    });
    seedTask(db, {
      id: 'soon',
      ownerId: 'alice',
      objectiveId: 'o1',
      importance: 3,
      urgency: 4,
      dueDate: new Date('2027-01-01'),
    });
    seedTask(db, { id: 'none', ownerId: 'alice', objectiveId: 'o1', importance: 4, urgency: 3 });
    seedTask(db, { id: 'mid', ownerId: 'alice', objectiveId: 'o1', importance: 3, urgency: 3 });
    seedTask(db, { id: 'other', ownerId: 'mallory', objectiveId: 'x', importance: 5, urgency: 5 });

    const result = await new WhatIsTodayFocusUsecase(taskRepository).execute('alice');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map((task) => task.id)).toEqual(['top', 'soon', 'late', 'none', 'mid']);
    expect(result.data[0]).toMatchObject({ objectiveId: 's1', important: 5, urgent: 5, done: false });
  });
});
