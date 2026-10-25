import { GetConversationsQuery, GetConversationsQueryInput, GetConversationsQueryOutput } from '@org/chat';
import { SupabaseClientDataAccess } from '../../supabase-client';

type MessageRow = { id: string; sender: string; content: string; created_at: string };

export class SupabaseGetAllMessagesQuery implements GetConversationsQuery {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  async execute(input: GetConversationsQueryInput): Promise<GetConversationsQueryOutput | null> {
    const db = this.supabaseClient.clientInstance;

    // La conversation appartient à la personne à qui appartient son objectif (jointure interne).
    const query =
      input.includeMessages === false
        ? db.from('conversations').select('id, objectives!inner(user_id)')
        : db
            .from('conversations')
            .select('id, objectives!inner(user_id), messages(id, sender, content, created_at)')
            .order('created_at', { referencedTable: 'messages' })
            .order('id', { referencedTable: 'messages' });

    const { data, error } = await query
      .eq('objective_id', input.externalReferenceId)
      .eq('objectives.user_id', input.ownerId)
      .order('created_at')
      .limit(1);

    if (error) {
      throw new Error(`Failed to fetch conversation for ${input.externalReferenceId}: ${error.message}`);
    }

    const conversation = data?.[0] as { id: string; messages?: MessageRow[] } | undefined;
    if (!conversation) {
      return null;
    }

    return {
      id: conversation.id,
      messages: (conversation.messages ?? []).map((message) => ({
        id: message.id,
        sender: message.sender,
        content: message.content,
        createdAt: new Date(message.created_at),
      })),
    };
  }
}
