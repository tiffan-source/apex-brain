import { Module } from '@nestjs/common';
import { IdGenerator } from '@org/chore';
import type { Provider } from '@nestjs/common';
import {
  AddSubObjectiveUsecase,
  AddTaskToObjectiveUsecase,
  ClarifyObjectiveUsecase,
  CompleteTaskUsecase,
  CreateObjectiveUsecase,
  DeleteObjectiveUsecase,
  DeleteTaskUsecase,
  MoveTaskUsecase,
  ObjectiveRepository,
  RemoveObjectiveDeadlineUsecase,
  RenameObjectiveUsecase,
  RenameTaskUsecase,
  ReopenTaskUsecase,
  ReprioritizeTaskUsecase,
  SetObjectiveDeadlineUsecase,
  TaskRepository,
  WhatIsTodayFocusUsecase,
} from '@org/objective';
import { AssistantModule } from '../assistant/assistant.module';
import { ObjectiveTreeController } from './bff/objective-tree.controller';
import { ObjectivesV2Controller } from './v2/objectives.v2.controller';
import { TasksV2Controller } from './v2/tasks.v2.controller';

/** Une commande construite sur un seul port. */
const onPort = <T, P>(
  provide: abstract new (...args: never[]) => T,
  port: abstract new (...args: never[]) => P,
  build: (port: P) => T,
): Provider => ({ provide, useFactory: build, inject: [port] });

/**
 * Le domaine objectif : ses commandes et la lecture BFF de l'arbre, assemblées sur ses ports (fournis
 * par les adaptateurs).
 */
@Module({
  // Supprimer un objectif met fin à son assistant (voir `ObjectivesV2Controller.remove`).
  imports: [AssistantModule],
  controllers: [ObjectivesV2Controller, TasksV2Controller, ObjectiveTreeController],
  providers: [
    onPort(
      RenameObjectiveUsecase,
      ObjectiveRepository,
      (repository) => new RenameObjectiveUsecase(repository),
    ),
    onPort(
      ClarifyObjectiveUsecase,
      ObjectiveRepository,
      (repository) => new ClarifyObjectiveUsecase(repository),
    ),
    onPort(
      SetObjectiveDeadlineUsecase,
      ObjectiveRepository,
      (repository) => new SetObjectiveDeadlineUsecase(repository),
    ),
    onPort(
      RemoveObjectiveDeadlineUsecase,
      ObjectiveRepository,
      (repository) => new RemoveObjectiveDeadlineUsecase(repository),
    ),
    onPort(MoveTaskUsecase, ObjectiveRepository, (repository) => new MoveTaskUsecase(repository)),
    onPort(RenameTaskUsecase, TaskRepository, (repository) => new RenameTaskUsecase(repository)),
    onPort(ReprioritizeTaskUsecase, TaskRepository, (repository) => new ReprioritizeTaskUsecase(repository)),
    onPort(CompleteTaskUsecase, TaskRepository, (repository) => new CompleteTaskUsecase(repository)),
    onPort(ReopenTaskUsecase, TaskRepository, (repository) => new ReopenTaskUsecase(repository)),
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
      provide: WhatIsTodayFocusUsecase,
      useFactory: (repository: TaskRepository) => new WhatIsTodayFocusUsecase(repository),
      inject: [TaskRepository],
    },
  ],
})
export class ObjectivesModule {}
