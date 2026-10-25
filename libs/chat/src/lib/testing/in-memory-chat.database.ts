import {
  AddMessageCommand,
  AddMessageCommandInput,
  AddMessageCommandOutput,
} from '../commands/add-message.command';
import {
  GetConversationsQuery,
  GetConversationsQueryInput,
  GetConversationsQueryOutput,
} from '../queries/get-conversation.query';

type ConversationRow = { id: string; externalReferenceId: string; ownerId: string };
type MessageRow = { id: string; conversationId: string; sender: string; content: string; createdAt: Date };

/** Conversations et messages en mémoire, avec les règles des adaptateurs Supabase. */
export class InMemoryChatDatabase {
  readonly conversations = new Map<string, ConversationRow>();
  readonly messages = new Map<string, MessageRow>();

  /** Fait échouer les prochains ajouts de message. */
  failWrites = false;

  private clock = Date.UTC(2026, 9, 25, 9, 0, 0);

  createConversation(
    externalReferenceId: string,
    ownerId: string,
    id = `conversation-${externalReferenceId}`,
  ): string {
    this.conversations.set(id, { id, externalReferenceId, ownerId });
    return id;
  }

  /** Une horloge qui avance d'une seconde à chaque message : l'ordre est stable. */
  now(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }
}

export class InMemoryGetConversationsQuery extends GetConversationsQuery {
  constructor(private readonly db: InMemoryChatDatabase) {
    super();
  }

  async execute(input: GetConversationsQueryInput): Promise<GetConversationsQueryOutput | null> {
    const conversation = [...this.db.conversations.values()].find(
      (row) => row.externalReferenceId === input.externalReferenceId && row.ownerId === input.ownerId,
    );
    if (!conversation) return null;

    const messages =
      input.includeMessages === false
        ? []
        : [...this.db.messages.values()]
            .filter((row) => row.conversationId === conversation.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
            .map(({ id, sender, content, createdAt }) => ({ id, sender, content, createdAt }));

    return { id: conversation.id, messages };
  }
}

export class InMemoryAddMessageCommand extends AddMessageCommand {
  constructor(private readonly db: InMemoryChatDatabase) {
    super();
  }

  async execute(input: AddMessageCommandInput): Promise<AddMessageCommandOutput> {
    if (this.db.failWrites) throw new Error(`Failed to add message to conversation ${input.conversationId}`);
    if (!this.db.conversations.has(input.conversationId)) {
      throw new Error(`Conversation ${input.conversationId} does not exist`);
    }

    const existing = this.db.messages.get(input.id);
    if (existing) return { id: existing.id, message: existing.content, createdAt: existing.createdAt };

    const row: MessageRow = {
      id: input.id,
      conversationId: input.conversationId,
      sender: input.userId,
      content: input.message,
      createdAt: this.db.now(),
    };
    this.db.messages.set(row.id, row);
    return { id: row.id, message: row.content, createdAt: row.createdAt };
  }
}

export function createInMemoryChatInfrastructure() {
  const db = new InMemoryChatDatabase();
  return {
    db,
    getConversationsQuery: new InMemoryGetConversationsQuery(db),
    addMessageCommand: new InMemoryAddMessageCommand(db),
  };
}
