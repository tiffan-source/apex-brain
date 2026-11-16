import { SupabaseUsagePolicySource } from '../lib/usage/usage-policy.source';
import { createIntegrationAccess, integrationEnabled } from './supabase-test-environment';

describe.skipIf(!integrationEnabled)("Supabase — politiques d'usage (intégration)", () => {
  it('lit les politiques livrées par la migration, par action puis par rôle', async () => {
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

  it('ne les ouvre à aucun client : la clé publique ne lit ni les politiques, ni le catalogue', async () => {
    const client = createIntegrationAccess().createAuthClient();

    for (const table of ['usage_policies', 'usage_actions'] as const) {
      const { data, error } = await client.from(table).select('*');
      expect(data).toBeNull();
      expect(error).toMatchObject({ code: '42501' });
    }
  });
});
