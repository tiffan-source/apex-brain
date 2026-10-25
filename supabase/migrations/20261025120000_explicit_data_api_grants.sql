-- Droits explicites des rôles de l'API de données.
--
-- Supabase n'expose plus automatiquement les nouvelles tables du schéma public aux rôles anon,
-- authenticated et service_role : sans ces GRANT, une base recréée (supabase db reset) refuserait
-- tout accès, y compris au serveur.
--
-- service_role : le serveur Apex Brain (clé secrète). Il contourne la RLS et vérifie lui-même la
-- propriété (docs/adr/0002-acces-aux-donnees.md).
-- authenticated : le client web d'Apex, tant qu'il appelle encore Supabase directement. Ces droits
-- seront retirés quand tous les clients passeront par l'API ; la RLS reste active dans tous les cas.

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table public.objectives to authenticated, service_role;
grant select, insert, update, delete on table public.tasks to authenticated, service_role;

grant select on table public.conversations to authenticated;
grant select, insert, update, delete on table public.conversations to service_role;

grant select, insert on table public.messages to authenticated;
grant select, insert, update, delete on table public.messages to service_role;

grant execute on function public.get_objective_subtree(text) to authenticated, service_role;
