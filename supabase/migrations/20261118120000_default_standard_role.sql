-- Le rôle `standard` : tout compte a au moins un rôle (docs/adr/0008-roles.md).
--
-- Les rôles vivent dans `app_metadata.roles` (raw_app_meta_data), que seul le serveur écrit.
-- Un compte « sans rôle » est un compte dont `roles` est absent, n'est pas un tableau ou est vide.
-- (comparaison à '[]' plutôt que jsonb_array_length, qui échoue sur autre chose qu'un tableau :
-- Postgres ne garantit pas l'ordre d'évaluation d'un `and`).

-- 1. Chaque nouveau compte reçoit `standard` avant d'être écrit : le rôle figure dès le premier
-- jeton, et l'opération est atomique avec l'inscription. Un rôle déjà posé à la création (par
-- l'API d'administration) est gardé tel quel.
create or replace function public.assign_default_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    jsonb_typeof(new.raw_app_meta_data -> 'roles') = 'array'
    and new.raw_app_meta_data -> 'roles' <> '[]'::jsonb
  ) is not true then
    new.raw_app_meta_data :=
      coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('roles', jsonb_build_array('standard'));
  end if;

  return new;
end;
$$;

-- Une fonction de trigger n'a rien à faire dans l'API de données.
revoke execute on function public.assign_default_role() from public, anon, authenticated;

create trigger trg_assign_default_role
before insert on auth.users
for each row
execute function public.assign_default_role();

-- 2. Les comptes existants sans rôle reçoivent `standard` ; ceux qui en ont déjà un ne bougent pas.
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('roles', jsonb_build_array('standard'))
where (
  jsonb_typeof(raw_app_meta_data -> 'roles') = 'array'
  and raw_app_meta_data -> 'roles' <> '[]'::jsonb
) is not true;
