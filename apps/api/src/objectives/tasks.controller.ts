import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserOutput } from '@org/auth';
import {
  DeleteTaskUsecase,
  EditMyTaskUsecase,
  UpdateDoneStatusOfTaskUsecase,
  WhatIsTodayFocusUsecase,
} from '@org/objective';
import { CurrentUser } from '../auth/auth.decorators';
import { openApiErrorSchema, openApiSchema } from '../http/openapi';
import { unwrap } from '../http/result';
import type { EditTaskBody, TaskDoneBody } from './objectives.schemas';
import {
  editTaskSchema,
  editedTaskResponseSchema,
  taskDoneResponseSchema,
  taskDoneSchema,
  taskIdParam,
  todayFocusResponseSchema,
} from './objectives.schemas';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(
    @Inject(EditMyTaskUsecase) private readonly editMyTask: EditMyTaskUsecase,
    @Inject(DeleteTaskUsecase) private readonly deleteTask: DeleteTaskUsecase,
    @Inject(UpdateDoneStatusOfTaskUsecase) private readonly updateDoneStatus: UpdateDoneStatusOfTaskUsecase,
    @Inject(WhatIsTodayFocusUsecase) private readonly whatIsTodayFocus: WhatIsTodayFocusUsecase,
  ) {}

  /** WhatIsTodayFocusUsecase : les cinq pas du jour. */
  @Get('today-focus')
  @ApiResponse({ status: 200, schema: openApiSchema(todayFocusResponseSchema) })
  async todayFocus(@CurrentUser() user: AuthenticatedUserOutput) {
    return unwrap(await this.whatIsTodayFocus.execute(user.id));
  }

  /** EditMyTaskUsecase : modifier un pas, ou le déplacer en changeant `objectiveId`. */
  @Patch(':taskId')
  @ApiResponse({ status: 200, schema: openApiSchema(editedTaskResponseSchema) })
  @ApiResponse({
    status: 404,
    description: 'TASK_NOT_FOUND, OBJECTIVE_NOT_FOUND',
    schema: openApiErrorSchema(),
  })
  async edit(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
    @Body({ schema: editTaskSchema }) body: EditTaskBody,
  ) {
    return unwrap(await this.editMyTask.execute({ task: { id: taskId, ...body }, ownerId: user.id }));
  }

  /** DeleteTaskUsecase */
  @Delete(':taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: 204, description: 'Pas supprimé' })
  @ApiResponse({ status: 404, description: 'TASK_NOT_FOUND', schema: openApiErrorSchema() })
  async remove(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
  ): Promise<void> {
    unwrap(await this.deleteTask.execute({ taskId, ownerId: user.id }));
  }

  /** UpdateDoneStatusOfTaskUsecase : cocher ou décocher un pas. */
  @Put(':taskId/done')
  @ApiResponse({ status: 200, schema: openApiSchema(taskDoneResponseSchema) })
  @ApiResponse({ status: 404, description: 'TASK_NOT_FOUND', schema: openApiErrorSchema() })
  async setDone(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('taskId', { schema: taskIdParam }) taskId: string,
    @Body({ schema: taskDoneSchema }) body: TaskDoneBody,
  ) {
    return unwrap(await this.updateDoneStatus.execute({ taskId, done: body.done, ownerId: user.id }));
  }
}
