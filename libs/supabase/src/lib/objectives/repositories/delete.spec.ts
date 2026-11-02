import { SupabaseClientDataAccess } from '../../supabase-client';
import { SupabaseObjectiveRepository } from './objective.repository';
import { SupabaseTaskRepository } from './task.repository';

/** Un PostgREST qui rend toujours la même réponse et garde les requêtes reçues. */
function fakePostgrest(status: number, body: unknown) {
  const requests: Array<{ url: string; method?: string; prefer: string | null }> = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      prefer: new Headers(init?.headers).get('Prefer'),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const access = new SupabaseClientDataAccess(
    { url: 'http://supabase.test', publishableKey: 'publishable', secretKey: 'secret' },
    { fetch },
  );

  return { access, requests };
}

describe.each([
  ['objectives', (access: SupabaseClientDataAccess) => new SupabaseObjectiveRepository(access)],
  ['tasks', (access: SupabaseClientDataAccess) => new SupabaseTaskRepository(access)],
])('suppression dans %s', (table, build) => {
  it('ne vise que la ligne de ce propriétaire, et demande ce qui a été supprimé', async () => {
    const { access, requests } = fakePostgrest(200, [{ id: 'x1' }]);

    await build(access).delete('x1', 'alice');

    expect(requests).toHaveLength(1);
    const [request] = requests;
    const url = new URL(request.url);
    expect(request.method).toBe('DELETE');
    expect(url.pathname).toBe(`/rest/v1/${table}`);
    expect(url.searchParams.get('id')).toBe('eq.x1');
    expect(url.searchParams.get('user_id')).toBe('eq.alice');
    expect(request.prefer).toContain('return=representation');
  });

  it('rend true quand une ligne est supprimée, false quand aucune ne correspond', async () => {
    await expect(build(fakePostgrest(200, [{ id: 'x1' }]).access).delete('x1', 'alice')).resolves.toBe(true);
    await expect(build(fakePostgrest(200, []).access).delete('x1', 'mallory')).resolves.toBe(false);
  });

  it('lève une erreur quand la base refuse', async () => {
    const { access } = fakePostgrest(500, { message: 'permission denied', code: '42501' });

    await expect(build(access).delete('x1', 'alice')).rejects.toThrow('permission denied');
  });
});
