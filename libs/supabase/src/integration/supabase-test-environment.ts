import { createClient } from '@supabase/supabase-js';
import { AppSupabaseConfig, SupabaseClientDataAccess } from '../lib/supabase-client';
import { Database } from '../lib/database.types';

/**
 * Les tests d'intégration tournent contre un vrai Supabase (local : `supabase start`), seulement
 * quand `SUPABASE_INTEGRATION=1`. Les clés viennent de `supabase status -o env`.
 */
export const integrationEnabled = process.env['SUPABASE_INTEGRATION'] === '1';

export function integrationConfig(): AppSupabaseConfig {
  const url = process.env['SUPABASE_URL'] ?? process.env['API_URL'];
  const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['ANON_KEY'];
  const secretKey = process.env['SUPABASE_SECRET_KEY'] ?? process.env['SERVICE_ROLE_KEY'];

  if (!url || !publishableKey || !secretKey) {
    throw new Error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY et SUPABASE_SECRET_KEY sont nécessaires');
  }

  return { url, publishableKey, secretKey };
}

export function createIntegrationAccess(): SupabaseClientDataAccess {
  return new SupabaseClientDataAccess(integrationConfig());
}

/** Créer une personne confirmée et rendre son id. */
export async function createTestUser(
  label: string,
): Promise<{ id: string; email: string; password: string }> {
  const config = integrationConfig();
  const admin = createClient<Database>(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@apex.test`;
  const password = 'secret-123456';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });

  if (error || !data.user) {
    throw new Error(`Création de la personne de test impossible : ${error?.message}`);
  }

  return { id: data.user.id, email, password };
}

/** Un id unique pour une ligne de test. */
export const testId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;
