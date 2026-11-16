import { isUsagePeriod, UsagePolicy, UsagePolicySource } from '@org/usage';
import { isRole } from '@org/user';
import { SupabaseClientDataAccess } from '../supabase-client';

type UsagePolicyRow = { action: string; role: string; quota: number | null; period: string };

const COLUMNS = 'action, role, quota, period';

/**
 * Les politiques d'usage, lues dans la table `usage_policies` à chaque décision : une ligne changée dans
 * Supabase compte dès la requête suivante (voir docs/adr/0010-politiques-d-usage.md).
 */
export class SupabaseUsagePolicySource implements UsagePolicySource {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  async forAction(action: string): Promise<UsagePolicy[]> {
    const { data, error } = await this.supabaseClient.clientInstance
      .from('usage_policies')
      .select(COLUMNS)
      .eq('action', action)
      .order('role');

    if (error) {
      throw new Error(`Failed to read the usage policies of ${action}: ${error.message}`);
    }

    return (data ?? []).map(toUsagePolicy);
  }

  async all(): Promise<UsagePolicy[]> {
    const { data, error } = await this.supabaseClient.clientInstance
      .from('usage_policies')
      .select(COLUMNS)
      .order('action')
      .order('role');

    if (error) {
      throw new Error(`Failed to read the usage policies: ${error.message}`);
    }

    return (data ?? []).map(toUsagePolicy);
  }
}

/**
 * Une ligne en politique. Les contraintes de la table refusent déjà un rôle, une période ou un quota
 * invalides ; une ligne qui passerait quand même (un rôle ajouté en base avant de l'être au code) fait
 * échouer la décision, plutôt que d'ouvrir ou de fermer une action en silence.
 */
export function toUsagePolicy(row: UsagePolicyRow): UsagePolicy {
  const { action, role, quota, period } = row;

  if (
    !isRole(role) ||
    !isUsagePeriod(period) ||
    !(quota === null || (Number.isInteger(quota) && quota >= 0))
  ) {
    throw new Error(
      `Invalid usage policy (${action}, ${role}): quota ${String(quota)}, period ${period}. ` +
        'Check the roles and periods known to the server.',
    );
  }

  return { action, role, quota, period };
}
