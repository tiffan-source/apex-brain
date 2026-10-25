import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserOutput } from '@org/auth';
import { GetConversationsQuery } from '@org/chat';
import { CurrentUser } from '../auth/auth.decorators';
import { DomainFailureException } from '../http/api-error';
import { openApiErrorSchema, openApiSchema } from '../http/openapi';
import { idSchema } from '../http/schemas';
import { conversationResponseSchema } from './conversation.schemas';

@ApiTags('conversation')
@ApiBearerAuth()
@Controller('objectives/:objectiveId/conversation')
export class ConversationController {
  constructor(@Inject(GetConversationsQuery) private readonly getConversation: GetConversationsQuery) {}

  /** GetConversationsQuery : la conversation avec l'assistant sur cet objectif, et ses messages. */
  @Get()
  @ApiResponse({ status: 200, schema: openApiSchema(conversationResponseSchema) })
  @ApiResponse({ status: 404, description: 'CONVERSATION_NOT_FOUND', schema: openApiErrorSchema() })
  async read(
    @CurrentUser() user: AuthenticatedUserOutput,
    @Param('objectiveId', { schema: idSchema }) objectiveId: string,
  ) {
    const conversation = await this.getConversation.execute({
      externalReferenceId: objectiveId,
      ownerId: user.id,
    });

    if (!conversation) {
      throw new DomainFailureException({
        code: 'CONVERSATION_NOT_FOUND',
        message: `No conversation found for reference ${objectiveId}`,
      });
    }

    return conversation;
  }
}
