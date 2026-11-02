import { Module } from '@nestjs/common';
import { IdGenerator } from '@org/chore';
import {
  AddSubObjectiveUsecase,
  AddTaskToObjectiveUsecase,
  CreateObjectiveUsecase,
  DeleteObjectiveUsecase,
  DeleteTaskUsecase,
  EditMyTaskUsecase,
  EditObjectiveUsecase,
  ObjectiveRepository,
  TaskRepository,
  UpdateDoneStatusOfTaskUsecase,
  WhatIsTodayFocusUsecase,
} from '@org/objective';
import { AssistantModule } from '../assistant/assistant.module';
import { ObjectivesController } from './objectives.controller';
import { TasksController } from './tasks.controller';

/** Les cas d'usage du domaine objectif, assemblés sur ses ports (fournis par les adaptateurs). */
@Module({
  // Supprimer un objectif met fin à son assistant (voir `ObjectivesController.remove`).
  imports: [AssistantModule],
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
      provide: DeleteObjectiveUsecase,
      useFactory: (repository: ObjectiveRepository) => new DeleteObjectiveUsecase(repository),
      inject: [ObjectiveRepository],
    },
    {
      provide: DeleteTaskUsecase,
      useFactory: (repository: TaskRepository) => new DeleteTaskUsecase(repository),
      inject: [TaskRepository],
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
  ],
})
export class ObjectivesModule {}
