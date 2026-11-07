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
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SendMessageToAIWorkflow } from '@org/ai-assistant';
import type { AuthenticatedUserOutput } from '@org/auth';
import {
  AddSubObjectiveUsecase,
  AddTaskToObjectiveUsecase,
  CreateObjectiveUsecase,
  DeleteObjectiveUsecase,
  EditObjectiveUsecase,
  GetMyObjectivesUsecase,
} from '@org/objective';
import { CurrentUser } from '../auth/auth.decorators';
import { openApiErrorSchema, openApiSchema } from '../http/openapi';
import { unwrap } from '../http/result';
import type { ObjectiveCommandOutput } from '@org/objective';
import type {
  AddSubObjectiveBody,
  AddTaskBody,
  CreateObjectiveBody,
  EditObjectiveBody,
} from './objectives.schemas';
import {
  addSubObjectiveSchema,
  addTaskSchema,
  createObjectiveSchema,
  createdTaskResponseSchema,
  editObjectiveSchema,
  objectiveIdParam,
  objectiveResponseSchema,
  objectivesResponseSchema,
  subObjectiveResponseSchema,
} from './objectives.schemas';

const deprecated = { deprecated: true, description: 'v1 gelée : utiliser la v2.' };

/** v1, gelée et dépréciée : supprimée quand les clients seront passés en v2 (docs/adr/0006). */
@ApiTags('objectives')
@ApiBearerAuth()
@Controller({ path: 'objectives', version: '1' })
export class ObjectivesController {
  constructor(
    @Inject(GetMyObjectivesUsecase) private readonly getMyObjectives: GetMyObjectivesUsecase,
    @Inject(CreateObjectiveUsecase) private readonly createObjective: CreateObjectiveUsecase,
    @Inject(EditObjectiveUsecase) private readonly editObjective: EditObjectiveUsecase,
    @Inject(DeleteObjectiveUsecase) private readonly deleteObjective: DeleteObjectiveUsecase,
    @Inject(SendMessageToAIWorkflow) private readonly assistant: SendMessageToAIWorkflow,
    @Inject(AddSubObjectiveUsecase) private readonly addSubObjective: AddSubObjectiveUsecase,
    @Inject(AddTaskToObjectiveUsecase) private readonly addTaskToObjective: AddTaskToObjectiveUsecase,
  ) {}

  /** GetMyObjectivesUsecase : tous les objectifs, étapes et pas de la personne, à plat, chacun fait ou non fait. */
  @ApiOperation(deprecated)
  @Get()
  @ApiResponse({ status: 200, schema: openApiSchema(objectivesResponseSchema) })
  async list(@CurrentUser() user: AuthenticatedUserOutput) {
    return unwrap(await this.getMyObjectives.execute({ ownerId: user.id }));
  }

  /** CreateObjectiveUsecase */
  @ApiOperation(deprecated)
  @Post()
  @ApiResponse({ status: 201, schema: openApiSchema(objectiveResponseSchema) })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: openApiErrorSchema() })
  async create(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Body({ schema: createObjectiveSchema }) body: CreateObjectiveBody,
  ) {
    return toV1Objective(unwrap(await this.createObjective.execute({ ...body, ownerId: user.id })));
  }

  /** EditObjectiveUsecase : un objectif ou une étape. */
  @ApiOperation(deprecated)
  @Patch(':objectiveId')
  @ApiResponse({ status: 200, schema: openApiSchema(objectiveResponseSchema) })
  @ApiResponse({ status: 404, description: 'OBJECTIVE_NOT_FOUND', schema: openApiErrorSchema() })
  async edit(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
    @Body({ schema: editObjectiveSchema }) body: EditObjectiveBody,
  ) {
    return unwrap(
      await this.editObjective.execute({ objective: { id: objectiveId, ...body }, ownerId: user.id }),
    );
  }

  /**
   * DeleteObjectiveUsecase : un objectif ou une étape, avec tout ce qui en dépend. La base emporte
   * étapes, pas, conversation et messages ; l'état de l'assistant, qui vit hors de la base, part ensuite.
   */
  @ApiOperation(deprecated)
  @Delete(':objectiveId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: 204, description: 'Supprimé, avec tout ce qui en dépend' })
  @ApiResponse({ status: 404, description: 'OBJECTIVE_NOT_FOUND', schema: openApiErrorSchema() })
  async remove(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
  ): Promise<void> {
    unwrap(await this.deleteObjective.execute({ objectiveId, ownerId: user.id }));
    await this.assistant.forget(objectiveId);
  }

  /** AddSubObjectiveUsecase : une étape sous un objectif ou une étape. */
  @ApiOperation(deprecated)
  @Post(':objectiveId/sub-objectives')
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ status: 201, schema: openApiSchema(subObjectiveResponseSchema) })
  @ApiResponse({ status: 404, description: 'OBJECTIVE_NOT_FOUND', schema: openApiErrorSchema() })
  async addSubObjectiveTo(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
    @Body({ schema: addSubObjectiveSchema }) body: AddSubObjectiveBody,
  ) {
    const { id, title } = unwrap(
      await this.addSubObjective.execute({
        parentObjectiveId: objectiveId,
        title: body.title,
        ownerId: user.id,
      }),
    );
    return { id, title };
  }

  /** AddTaskToObjectiveUsecase : un pas sur un objectif ou une étape. */
  @ApiOperation(deprecated)
  @Post(':objectiveId/tasks')
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ status: 201, schema: openApiSchema(createdTaskResponseSchema) })
  @ApiResponse({ status: 404, description: 'OBJECTIVE_NOT_FOUND', schema: openApiErrorSchema() })
  async addTask(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
    @Body({ schema: addTaskSchema }) body: AddTaskBody,
  ) {
    const { id, title, importance, urgency } = unwrap(
      await this.addTaskToObjective.execute({ objectiveId, ...body, ownerId: user.id }),
    );
    return { id, title, importance, urgency };
  }
}

/** La forme de la v1 : les champs vides sont absents. */
function toV1Objective(objective: ObjectiveCommandOutput) {
  return {
    id: objective.id,
    title: objective.title,
    description: objective.description || undefined,
    why: objective.why || undefined,
    dueDate: objective.dueDate ?? undefined,
  };
}
