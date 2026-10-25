import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SendMessageToAIWorkflow } from '@org/ai-assistant';
import type { AuthenticatedUserOutput } from '@org/auth';
import { CurrentUser } from '../auth/auth.decorators';
import { openApiErrorSchema, openApiSchema } from '../http/openapi';
import { unwrap } from '../http/result';
import { idSchema } from '../http/schemas';
import { RateLimit } from '../rate-limit/rate-limit';
import type { PermissionBody, SendMessageBody } from './assistant.schemas';
import { permissionSchema, sendMessageSchema, workflowStateResponseSchema } from './assistant.schemas';

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('objectives/:objectiveId/assistant')
export class AssistantController {
  constructor(@Inject(SendMessageToAIWorkflow) private readonly workflow: SendMessageToAIWorkflow) {}

  /**
   * L'état du workflow (startWorkFlow + getState d'Apex) : un tour interrompu reprend, un workflow
   * qui n'a jamais servi est décrit sans être créé. À interroger pendant un tour.
   */
  @Get()
  @ApiResponse({ status: 200, schema: openApiSchema(workflowStateResponseSchema) })
  @ApiResponse({ status: 404, description: 'CONVERSATION_NOT_FOUND', schema: openApiErrorSchema() })
  async state(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: idSchema }) objectiveId: string,
  ) {
    return unwrap(await this.workflow.getState(objectiveId, user.id));
  }

  /** sendMessage : le tour démarre, la réponse arrive par l'état. */
  @Post('messages')
  @RateLimit('assistant-message')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiResponse({ status: 202, schema: openApiSchema(workflowStateResponseSchema) })
  @ApiResponse({ status: 404, description: 'CONVERSATION_NOT_FOUND', schema: openApiErrorSchema() })
  @ApiResponse({ status: 409, description: 'WORKFLOW_BUSY', schema: openApiErrorSchema() })
  async sendMessage(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: idSchema }) objectiveId: string,
    @Body({ schema: sendMessageSchema }) body: SendMessageBody,
  ) {
    return unwrap(await this.workflow.sendMessage(objectiveId, user.id, body.message));
  }

  /** respondToPermission : accepter ou refuser l'outil qui attend. */
  @Post('permission')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiResponse({ status: 202, schema: openApiSchema(workflowStateResponseSchema) })
  @ApiResponse({ status: 409, description: 'NO_PENDING_PERMISSION', schema: openApiErrorSchema() })
  async respondToPermission(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: idSchema }) objectiveId: string,
    @Body({ schema: permissionSchema }) body: PermissionBody,
  ) {
    return unwrap(
      await this.workflow.respondToPermission(objectiveId, user.id, body.granted, body.toolCallId),
    );
  }
}
