import { AddMessageCommand, ConversationNotFoundError, GetConversationsQuery } from '@org/chat';
import { IChatActor, RegisterMessageInput, RegisterMessageResult } from '../workflow/actors.protocols';

/** L'acteur conversation du workflow, branché sur `@org/chat`. */
export class ChatService implements IChatActor {
  constructor(
    private readonly conversationQuery: GetConversationsQuery,
    private readonly messageGateway: AddMessageCommand,
  ) {}

  async registerMessage(input: RegisterMessageInput): Promise<RegisterMessageResult> {
    const conversation = await this.conversationQuery.execute({
      externalReferenceId: input.conversationExternalRef,
      ownerId: input.ownerId,
      includeMessages: false,
    });

    if (!conversation) {
      throw new ConversationNotFoundError(input.conversationExternalRef);
    }

    const saved = await this.messageGateway.execute({
      id: input.messageId,
      conversationId: conversation.id,
      userId: input.senderId,
      message: input.content,
    });

    return {
      success: true,
      message: {
        id: saved.id,
        content: saved.message,
        sender: input.senderId,
        createdAt: saved.createdAt,
      },
    };
  }

  async hasConversation(conversationExternalRef: string, ownerId: string): Promise<boolean> {
    const conversation = await this.conversationQuery.execute({
      externalReferenceId: conversationExternalRef,
      ownerId,
      includeMessages: false,
    });
    return conversation !== null;
  }
}
