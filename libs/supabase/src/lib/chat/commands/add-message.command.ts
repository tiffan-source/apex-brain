import { AddMessageCommand, AddMessageCommandInput, AddMessageCommandOutput } from '@org/chat';
import { SupabaseClientDataAccess } from '../../supabase-client';

export class SupabaseAddMessageCommand implements AddMessageCommand {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  async execute(input: AddMessageCommandInput): Promise<AddMessageCommandOutput> {
    const db = this.supabaseClient.clientInstance;
    const { id, conversationId, message, userId } = input;

    // Rejouer l'ajout avec le même id ne double pas le message (reprise d'un workflow interrompu).
    const { data, error } = await db
      .from('messages')
      .upsert(
        { id, conversation_id: conversationId, content: message, sender: userId },
        { onConflict: 'id', ignoreDuplicates: true },
      )
      .select('id, content, created_at');

    if (error) {
      throw new Error(`Failed to add message to conversation ${conversationId}: ${error.message}`);
    }

    const saved = data?.[0] ?? (await this.findExisting(id));

    // La date est celle de la base (dans Apex, elle était inventée côté client).
    return { id: saved.id, message: saved.content, createdAt: new Date(saved.created_at) };
  }

  private async findExisting(id: string): Promise<{ id: string; content: string; created_at: string }> {
    const { data, error } = await this.supabaseClient.clientInstance
      .from('messages')
      .select('id, content, created_at')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(`Failed to read message ${id}: ${error.message}`);
    }

    return data;
  }
}
