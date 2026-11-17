import { SupabaseClientDataAccess } from '../supabase-client';
import { SupabaseUsagePolicySource, toUsagePolicy } from './usage-policy.source';

/** Un faux PostgREST : enregistre la requête reçue et rend les lignes données. */
function fakeSupabase(rows: unknown[], status = 200) {
  const requests: URL[] = [];
  const fetch = async (input: string | URL | Request) => {
    requests.push(new URL(input instanceof Request ? input.url : input.toString()));
    return new Response(JSON.stringify(status === 200 ? rows : { message: 'permission denied' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const access = new SupabaseClientDataAccess(
    { url: 'http://supabase.test', publishableKey: 'publishable', secretKey: 'secret' },
    { fetch: fetch as typeof globalThis.fetch },
  );
  return { source: new SupabaseUsagePolicySource(access), requests };
}

const rows = [
  { action: 'assistant.send-message', role: 'admin', quota: null, period: 'lifetime' },
  { action: 'assistant.send-message', role: 'premium', quota: null, period: 'lifetime' },
  { action: 'assistant.send-message', role: 'standard', quota: 3, period: 'lifetime' },
];

describe('SupabaseUsagePolicySource', () => {
  it("lit les politiques en vigueur d'une action, triées par rôle", async () => {
    const { source, requests } = fakeSupabase(rows);

    await expect(source.forAction('assistant.send-message')).resolves.toEqual(rows);

    // La vue ne garde que les actions dont l'interrupteur est allumé : la lib n'a pas à le savoir.
    expect(requests[0].pathname).toBe('/rest/v1/usage_policies_in_force');
    expect(requests[0].searchParams.get('action')).toBe('eq.assistant.send-message');
    expect(requests[0].searchParams.get('order')).toBe('role.asc');
  });

  it('lit toutes les politiques en vigueur, triées par action puis par rôle', async () => {
    const { source, requests } = fakeSupabase(rows);

    await expect(source.all()).resolves.toHaveLength(3);

    expect(requests[0].searchParams.get('order')).toBe('action.asc,role.asc');
  });

  it("signale une table illisible au lieu de laisser l'action libre", async () => {
    const { source } = fakeSupabase([], 401);

    await expect(source.forAction('assistant.send-message')).rejects.toThrow(/usage policies/);
  });
});

describe('toUsagePolicy', () => {
  it('refuse une ligne que le serveur ne sait pas lire, plutôt que de décider au hasard', () => {
    const valid = { action: 'assistant.send-message', role: 'standard', quota: 3, period: 'lifetime' };

    expect(toUsagePolicy(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, role: 'vip' },
      { ...valid, period: 'week' },
      { ...valid, quota: -1 },
      { ...valid, quota: 1.5 },
      { ...valid, action: null },
      { ...valid, role: null },
    ]) {
      expect(() => toUsagePolicy(invalid)).toThrow(/Invalid usage policy/);
    }
  });
});
