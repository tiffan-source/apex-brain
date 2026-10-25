import { Module } from '@nestjs/common';
import { IdGenerator } from '@org/chore';
import {
  AddSubObjectiveUsecase,
  AddTaskToObjectiveUsecase,
  CreateObjectiveUsecase,
  EditMyTaskUsecase,
  EditObjectiveUsecase,
  ObjectiveInternalService,
  ObjectiveRepository,
  TaskRepository,
  UpdateDoneStatusOfTaskUsecase,
  WhatIsTodayFocusUsecase,
} from '@org/objective';
import { ObjectivesController } from './objectives.controller';
import { TasksController } from './tasks.controller';

/** Les cas d'usage du domaine objectif, assemblés sur ses ports (fournis par les adaptateurs). */
@Module({
  controllers: [ObjectivesController, TasksController],
  providers: [
    {
      provide: CreateObjectiveUsecase,
      useFactory: (repository: ObjectiveRepository, ids: IdGenerator) =>
        new CreateObjectiveUsecase(repository, ids),
      inject: [ObjectiveRepository, IdGenerator],
    },
    {
      provide: AddSubObjectiveUsecase,
      useFactory: (repository: ObjectiveRepository, ids: IdGenerator) =>
        new AddSubObjectiveUsecase(repository, ids),
      inject: [ObjectiveRepository, IdGenerator],
    },
    {
      provide: AddTaskToObjectiveUsecase,
      useFactory: (repository: ObjectiveRepository, ids: IdGenerator) =>
        new AddTaskToObjectiveUsecase(repository, ids),
      inject: [ObjectiveRepository, IdGenerator],
    },
    {
      provide: EditObjectiveUsecase,
      useFactory: (repository: ObjectiveRepository) => new EditObjectiveUsecase(repository),
      inject: [ObjectiveRepository],
    },
    {
      provide: EditMyTaskUsecase,
      useFactory: (repository: ObjectiveRepository) => new EditMyTaskUsecase(repository),
      inject: [ObjectiveRepository],
    },
    {
      provide: UpdateDoneStatusOfTaskUsecase,
      useFactory: (repository: TaskRepository) => new UpdateDoneStatusOfTaskUsecase(repository),
      inject: [TaskRepository],
    },
    {
      provide: WhatIsTodayFocusUsecase,
      useFactory: (repository: TaskRepository) => new WhatIsTodayFocusUsecase(repository),
      inject: [TaskRepository],
    },
    {
      provide: ObjectiveInternalService,
      useFactory: (repository: ObjectiveRepository, ids: IdGenerator) =>
        new ObjectiveInternalService(repository, ids),
      inject: [ObjectiveRepository, IdGenerator],
    },
  ],
  exports: [ObjectiveInternalService],
})
export class ObjectivesModule {}
