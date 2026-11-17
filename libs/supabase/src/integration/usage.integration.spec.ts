import { SupabaseUsagePolicySource } from '../lib/usage/usage-policy.source';
import { createIntegrationAccess, createTestUser, integrationEnabled } from './supabase-test-environment';

describe.skipIf(!integrationEnabled)("Supabase — politiques d'usage (intégration)", () => {
  it('lit les politiques livrées par la migration, en vigueur dès le départ', async () => {
    const source = new SupabaseUsagePolicySource(createIntegrationAccess());

    await expect(source.forAction('assistant.send-message')).resolves.toEqual([
      { action: 'assistant.send-message', role: 'admin', quota: null, period: 'lifetime' },
      { action: 'assistant.send-message', role: 'premium', quota: null, period: 'lifetime' },
      { action: 'assistant.send-message', role: 'standard', quota: 3, period: 'lifetime' },
    ]);
    await expect(source.forAction('action.inconnue')).resolves.toEqual([]);
    expect((await source.all()).filter((policy) => policy.action === 'assistant.send-message')).toHaveLength(
      3,
    );
  });

  it("n'en laisse lire aucune ligne à un client, connecté ou non", async () => {
    const anonymous = createIntegrationAccess().createAuthClient();
    const person = await createTestUser('lecture-politiques');
    const signedIn = createIntegrationAccess().createAuthClient();
    await signedIn.auth.signInWithPassword({ email: person.email, password: person.password });

    for (const client of [anonymous, signedIn]) {
      const reads = await Promise.all([
        client.from('usage_policies').select('*'),
        client.from('usage_actions').select('*'),
        client.from('usage_policies_in_force').select('*'),
      ]);

      for (const { data, error } of reads) {
        // La migration retire tout droit aux clients (42501). Si une base en redonnait, la RLS, sans aucune
        // politique, ne laisserait passer aucune ligne. Dans les deux cas, rien n'est lu.
        if (error) expect(error.code).toBe('42501');
        expect(data ?? []).toEqual([]);
      }
    }
  });

  it("ne laisse pas une personne connectée s'offrir des messages : ni politique modifiée, ni action coupée", async () => {
    const person = await createTestUser('triche-politiques');
    const client = createIntegrationAccess().createAuthClient();
    await client.auth.signInWithPassword({ email: person.email, password: person.password });

    await client.from('usage_policies').update({ quota: 1000 }).eq('role', 'standard');
    await client.from('usage_policies').delete().eq('action', 'assistant.send-message');
    await client.from('usage_actions').update({ enforced: false }).eq('action', 'assistant.send-message');

    const policies = await new SupabaseUsagePolicySource(createIntegrationAccess()).forAction(
      'assistant.send-message',
    );
    expect(policies).toContainEqual({
      action: 'assistant.send-message',
      role: 'standard',
      quota: 3,
      period: 'lifetime',
    });
    expect(policies).toHaveLength(3);
  });
});
