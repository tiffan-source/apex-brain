import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserOutput } from '@org/auth';
import {
  CompleteTaskUsecase,
  DeleteTaskUsecase,
  MoveTaskUsecase,
  RenameTaskUsecase,
  ReopenTaskUsecase,
  ReprioritizeTaskUsecase,
  WhatIsTodayFocusUsecase,
} from '@org/objective';
import { CurrentUser } from '../../auth/auth.decorators';
import { openApiErrorSchema, openApiSchema } from '../../http/openapi';
import { unwrap } from '../../http/result';
import { taskIdParam, todayFocusResponseSchema } from '../objectives.schemas';
import type { MoveTaskBody, RenameBody, ReprioritizeTaskBody } from './objectives.v2.schemas';
import {
  moveTaskSchema,
  renameSchema,
  reprioritizeTaskSchema,
  taskCommandResponseSchema,
} from './objectives.v2.schemas';

const taskNotFound = { status: 404, description: 'TASK_NOT_FOUND', schema: openApiErrorSchema() };
const invalidBody = { status: 400, description: 'VALIDATION_ERROR', schema: openApiErrorSchema() };
const taskResponse = { status: 200, schema: openApiSchema(taskCommandResponseSchema) };

/** Les commandes sur un pas (un geste nommé chacune, le pas modifié en retour) et le focus du jour. */
@ApiTags('tasks')
@ApiBearerAuth()
@Controller({ path: 'tasks', version: '2' })
export class TasksV2Controller {
  constructor(
    @Inject(RenameTaskUsecase) private readonly renameTask: RenameTaskUsecase,
    @Inject(ReprioritizeTaskUsecase) private readonly reprioritizeTask: ReprioritizeTaskUsecase,
    @Inject(MoveTaskUsecase) private readonly moveTask: MoveTaskUsecase,
    @Inject(CompleteTaskUsecase) private readonly completeTask: CompleteTaskUsecase,
    @Inject(ReopenTaskUsecase) private readonly reopenTask: ReopenTaskUsecase,
    @Inject(DeleteTaskUsecase) private readonly deleteTask: DeleteTaskUsecase,
    @Inject(WhatIsTodayFocusUsecase) private readonly whatIsTodayFocus: WhatIsTodayFocusUsecase,
  ) {}

  @Get('today-focus')
  @ApiOperation({
    operationId: 'whatIsTodayFocus',
    summary: 'Les cinq pas sur lesquels se concentrer aujourd’hui',
  })
  @ApiResponse({ status: 200, schema: openApiSchema(todayFocusResponseSchema) })
  async todayFocus(@CurrentUser() user: AuthenticatedUserOutput) {
    return unwrap(await this.whatIsTodayFocus.execute(user.id));
  }

  @Patch(':taskId/rename')
  @ApiOperation({ operationId: 'renameTask', summary: 'Donner un nouveau titre à un pas' })
  @ApiResponse(taskResponse)
  @ApiResponse(invalidBody)
  @ApiResponse(taskNotFound)
  async rename(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
    @Body({ schema: renameSchema }) body: RenameBody,
  ) {
    return unwrap(await this.renameTask.execute({ taskId, title: body.title, ownerId: user.id }));
  }

  @Patch(':taskId/reprioritize')
  @ApiOperation({ operationId: 'reprioritizeTask', summary: "Revoir l'importance et l'urgence d'un pas" })
  @ApiResponse(taskResponse)
  @ApiResponse(invalidBody)
  @ApiResponse(taskNotFound)
  async reprioritize(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
    @Body({ schema: reprioritizeTaskSchema }) body: ReprioritizeTaskBody,
  ) {
    return unwrap(await this.reprioritizeTask.execute({ taskId, ...body, ownerId: user.id }));
  }

  @Patch(':taskId/move')
  @ApiOperation({
    operationId: 'moveTask',
    summary: 'Déplacer un pas vers un autre objectif ou une autre étape',
  })
  @ApiResponse(taskResponse)
  @ApiResponse(invalidBody)
  @ApiResponse({
    status: 404,
    description: 'TASK_NOT_FOUND, OBJECTIVE_NOT_FOUND',
    schema: openApiErrorSchema(),
  })
  async move(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
    @Body({ schema: moveTaskSchema }) body: MoveTaskBody,
  ) {
    return unwrap(await this.moveTask.execute({ taskId, objectiveId: body.objectiveId, ownerId: user.id }));
  }

  @Patch(':taskId/complete')
  @ApiOperation({ operationId: 'completeTask', summary: 'Marquer un pas comme fait' })
  @ApiResponse(taskResponse)
  @ApiResponse(taskNotFound)
  async complete(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
  ) {
    return unwrap(await this.completeTask.execute({ taskId, ownerId: user.id }));
  }

  @Patch(':taskId/reopen')
  @ApiOperation({ operationId: 'reopenTask', summary: 'Remettre un pas à faire' })
  @ApiResponse(taskResponse)
  @ApiResponse(taskNotFound)
  async reopen(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
  ) {
    return unwrap(await this.reopenTask.execute({ taskId, ownerId: user.id }));
  }

  @Delete(':taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteTask', summary: 'Supprimer un pas' })
  @ApiResponse({ status: 204, description: 'Pas supprimé' })
  @ApiResponse(taskNotFound)
  async remove(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
  ): Promise<void> {
    unwrap(await this.deleteTask.execute({ taskId, ownerId: user.id }));
  }
}
