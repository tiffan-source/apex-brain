import { isUsagePeriod, UsagePolicy, UsagePolicySource } from '@org/usage';
import { isRole } from '@org/user';
import { SupabaseClientDataAccess } from '../supabase-client';

/** Une ligne de la vue : Postgres ne garantit pas qu'une colonne de vue soit non nulle. */
type UsagePolicyRow = {
  action: string | null;
  role: string | null;
  quota: number | null;
  period: string | null;
};

/** Les politiques des actions dont l'interrupteur (`usage_actions.enforced`) est allumé. */
const IN_FORCE = 'usage_policies_in_force';
const COLUMNS = 'action, role, quota, period';

/**
 * Les politiques d'usage en vigueur, lues à chaque décision dans la vue `usage_policies_in_force` : une ligne
 * changée, ou une action coupée dans Supabase, compte dès la requête suivante. Ce qui est « en vigueur » se
 * décide dans la base ; la lib n'en sait rien (voir docs/adr/0010-politiques-d-usage.md).
 */
export class SupabaseUsagePolicySource implements UsagePolicySource {
  constructor(private readonly supabaseClient: SupabaseClientDataAccess) {}

  async forAction(action: string): Promise<UsagePolicy[]> {
    const { data, error } = await this.supabaseClient.clientInstance
      .from(IN_FORCE)
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
      .from(IN_FORCE)
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
 * Une ligne en politique. Les contraintes des tables refusent déjà un rôle, une période ou un quota
 * invalides ; une ligne qui passerait quand même (un rôle ajouté en base avant de l'être au code) fait
 * échouer la décision, plutôt que d'ouvrir ou de fermer une action en silence.
 */
export function toUsagePolicy(row: UsagePolicyRow): UsagePolicy {
  const { action, role, quota, period } = row;

  if (
    !action ||
    !isRole(role) ||
    !isUsagePeriod(period) ||
    !(quota === null || (Number.isInteger(quota) && quota >= 0))
  ) {
    throw new Error(
      `Invalid usage policy (${String(action)}, ${String(role)}): quota ${String(quota)}, ` +
        `period ${String(period)}. Check the roles and periods known to the server.`,
    );
  }

  return { action, role, quota, period };
}
