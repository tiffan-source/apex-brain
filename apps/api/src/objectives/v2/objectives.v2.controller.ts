import { Body, Controller, Delete, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SendMessageToAIWorkflow } from '@org/ai-assistant';
import type { AuthenticatedUserOutput } from '@org/auth';
import {
  AddSubObjectiveUsecase,
  AddTaskToObjectiveUsecase,
  ClarifyObjectiveUsecase,
  CreateObjectiveUsecase,
  DeleteObjectiveUsecase,
  RemoveObjectiveDeadlineUsecase,
  RenameObjectiveUsecase,
  SetObjectiveDeadlineUsecase,
} from '@org/objective';
import { CurrentUser } from '../../auth/auth.decorators';
import { openApiErrorSchema, openApiSchema } from '../../http/openapi';
import { unwrap } from '../../http/result';
import type { AddSubObjectiveBody, AddTaskBody, CreateObjectiveBody } from '../objectives.schemas';
import {
  addSubObjectiveSchema,
  addTaskSchema,
  createObjectiveSchema,
  objectiveIdParam,
} from '../objectives.schemas';
import type { ClarifyObjectiveBody, RenameBody, SetObjectiveDeadlineBody } from './objectives.v2.schemas';
import {
  clarifyObjectiveSchema,
  objectiveCommandResponseSchema,
  renameSchema,
  setObjectiveDeadlineSchema,
  taskCommandResponseSchema,
} from './objectives.v2.schemas';

const objectiveNotFound = { status: 404, description: 'OBJECTIVE_NOT_FOUND', schema: openApiErrorSchema() };
const invalidBody = { status: 400, description: 'VALIDATION_ERROR', schema: openApiErrorSchema() };
const objectiveResponse = (status: number) => ({
  status,
  schema: openApiSchema(objectiveCommandResponseSchema),
});

/** Les commandes sur un objectif ou une étape : un geste nommé chacune, l'entité modifiée en retour. */
@ApiTags('objectives')
@ApiBearerAuth()
@Controller({ path: 'objectives', version: '2' })
export class ObjectivesV2Controller {
  constructor(
    @Inject(CreateObjectiveUsecase) private readonly createObjective: CreateObjectiveUsecase,
    @Inject(AddSubObjectiveUsecase) private readonly addSubObjective: AddSubObjectiveUsecase,
    @Inject(AddTaskToObjectiveUsecase) private readonly addTaskToObjective: AddTaskToObjectiveUsecase,
    @Inject(RenameObjectiveUsecase) private readonly renameObjective: RenameObjectiveUsecase,
    @Inject(ClarifyObjectiveUsecase) private readonly clarifyObjective: ClarifyObjectiveUsecase,
    @Inject(SetObjectiveDeadlineUsecase) private readonly setObjectiveDeadline: SetObjectiveDeadlineUsecase,
    @Inject(RemoveObjectiveDeadlineUsecase)
    private readonly removeObjectiveDeadline: RemoveObjectiveDeadlineUsecase,
    @Inject(DeleteObjectiveUsecase) private readonly deleteObjective: DeleteObjectiveUsecase,
    @Inject(SendMessageToAIWorkflow) private readonly assistant: SendMessageToAIWorkflow,
  ) {}

  @Post()
  @ApiOperation({ operationId: 'createObjective', summary: 'Définir un nouvel objectif principal' })
  @ApiResponse(objectiveResponse(201))
  @ApiResponse(invalidBody)
  async create(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Body({ schema: createObjectiveSchema }) body: CreateObjectiveBody,
  ) {
    return unwrap(await this.createObjective.execute({ ...body, ownerId: user.id }));
  }

  @Post(':objectiveId/sub-objectives')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'addSubObjective',
    summary: 'Ajouter une étape sous un objectif ou une étape',
  })
  @ApiResponse(objectiveResponse(201))
  @ApiResponse(objectiveNotFound)
  async addSubObjectiveTo(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
    @Body({ schema: addSubObjectiveSchema }) body: AddSubObjectiveBody,
  ) {
    return unwrap(
      await this.addSubObjective.execute({
        parentObjectiveId: objectiveId,
        title: body.title,
        ownerId: user.id,
      }),
    );
  }

  @Post(':objectiveId/tasks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'addTaskToObjective', summary: 'Ajouter un pas à un objectif ou à une étape' })
  @ApiResponse({ status: 201, schema: openApiSchema(taskCommandResponseSchema) })
  @ApiResponse(objectiveNotFound)
  async addTask(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
    @Body({ schema: addTaskSchema }) body: AddTaskBody,
  ) {
    return unwrap(await this.addTaskToObjective.execute({ objectiveId, ...body, ownerId: user.id }));
  }

  @Patch(':objectiveId/rename')
  @ApiOperation({
    operationId: 'renameObjective',
    summary: 'Donner un nouveau titre à un objectif ou à une étape',
  })
  @ApiResponse(objectiveResponse(200))
  @ApiResponse(objectiveNotFound)
  async rename(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
    @Body({ schema: renameSchema }) body: RenameBody,
  ) {
    return unwrap(await this.renameObjective.execute({ objectiveId, title: body.title, ownerId: user.id }));
  }

  @Patch(':objectiveId/clarify')
  @ApiOperation({
    operationId: 'clarifyObjective',
    summary: "Préciser ce qu'est un objectif (ou une étape) et pourquoi on le poursuit",
    description: 'Au moins `description` ou `why`. Un champ absent reste inchangé ; `""` le vide.',
  })
  @ApiResponse(objectiveResponse(200))
  @ApiResponse(invalidBody)
  @ApiResponse(objectiveNotFound)
  async clarify(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
    @Body({ schema: clarifyObjectiveSchema }) body: ClarifyObjectiveBody,
  ) {
    return unwrap(await this.clarifyObjective.execute({ objectiveId, ...body, ownerId: user.id }));
  }

  @Patch(':objectiveId/set-deadline')
  @ApiOperation({
    operationId: 'setObjectiveDeadline',
    summary: "Fixer l'échéance d'un objectif ou d'une étape",
  })
  @ApiResponse(objectiveResponse(200))
  @ApiResponse(invalidBody)
  @ApiResponse(objectiveNotFound)
  async setDeadline(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
    @Body({ schema: setObjectiveDeadlineSchema }) body: SetObjectiveDeadlineBody,
  ) {
    return unwrap(
      await this.setObjectiveDeadline.execute({ objectiveId, dueDate: body.dueDate, ownerId: user.id }),
    );
  }

  @Patch(':objectiveId/remove-deadline')
  @ApiOperation({
    operationId: 'removeObjectiveDeadline',
    summary: "Retirer l'échéance d'un objectif ou d'une étape",
  })
  @ApiResponse(objectiveResponse(200))
  @ApiResponse(objectiveNotFound)
  async removeDeadline(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
  ) {
    return unwrap(await this.removeObjectiveDeadline.execute({ objectiveId, ownerId: user.id }));
  }

  /**
   * Un objectif ou une étape, avec tout ce qui en dépend. La base emporte étapes, pas, conversation
   * et messages ; l'état de l'assistant, qui vit hors de la base, part ensuite.
   */
  @Delete(':objectiveId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'deleteObjective',
    summary: 'Supprimer un objectif ou une étape, avec tout ce qui en dépend',
  })
  @ApiResponse({ status: 204, description: 'Supprimé, avec tout ce qui en dépend' })
  @ApiResponse(objectiveNotFound)
  async remove(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: objectiveIdParam }) objectiveId: string,
  ): Promise<void> {
    unwrap(await this.deleteObjective.execute({ objectiveId, ownerId: user.id }));
    await this.assistant.forget(objectiveId);
  }
}
