import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';

export type AppSupabaseConfig = {
  url: string;
  /** Clé publique (anon / publishable) : opérations d'authentification au nom de la personne. */
  publishableKey: string;
  /** Clé secrète (service_role / secret) : accès aux données et administration, côté serveur seulement. */
  secretKey: string;
};

export type SupabaseClientOptions = {
  /** Remplacer `fetch` (tests). */
  fetch?: typeof fetch;
};

/** Aucune session gardée : un client du serveur ne doit jamais hériter du jeton d'une personne. */
const SERVER_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

/**
 * Les clients Supabase du serveur.
 *
 * `clientInstance` porte la clé secrète et ne se connecte jamais : il sert aux données (la
 * propriété est vérifiée par les adaptateurs, voir docs/adr/0002-acces-aux-donnees.md), à la
 * vérification des jetons et à l'administration. Les connexions passent par `createAuthClient`,
 * un client neuf par opération : un `signInWithPassword` sur le client partagé y installerait la
 * session de la personne pour toutes les requêtes suivantes.
 */
export class SupabaseClientDataAccess {
  private readonly client: SupabaseClient<Database>;

  constructor(
    private readonly config: AppSupabaseConfig,
    private readonly options: SupabaseClientOptions = {},
  ) {
    this.client = createClient<Database>(config.url, config.secretKey, {
      auth: SERVER_AUTH_OPTIONS,
      global: options.fetch ? { fetch: options.fetch } : undefined,
    });
  }

  get clientInstance(): SupabaseClient<Database> {
    return this.client;
  }

  /** Un client jetable, avec la clé publique, pour une seule opération d'authentification. */
  createAuthClient(): SupabaseClient<Database> {
    return createClient<Database>(this.config.url, this.config.publishableKey, {
      auth: SERVER_AUTH_OPTIONS,
      global: this.options.fetch ? { fetch: this.options.fetch } : undefined,
    });
  }
}
