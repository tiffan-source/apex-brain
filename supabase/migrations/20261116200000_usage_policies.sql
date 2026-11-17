-- Politiques d'usage : qui peut faire quelle action d'Apex, et combien de fois
-- (docs/adr/0010-politiques-d-usage.md).
--
-- Des règles de produit, pas des règles métier : elles changent avec la stratégie, sans déploiement. Le
-- serveur lit les politiques en vigueur à chaque décision, si bien qu'une ligne changée compte dès la requête
-- suivante. Une action est libre quand aucune politique ne la nomme, ou quand son interrupteur est coupé.
-- Les compteurs vivent hors de cette base (Firestore, collection usage-counters).

-- Le catalogue des actions que le serveur sait gouverner : une par étiquette @UsageAction du code. Une
-- politique ne peut nommer qu'une action d'ici : une faute de frappe est refusée au lieu de laisser l'action
-- libre en silence.
create table public.usage_actions (
  action text primary key,
  description text not null,
  -- L'interrupteur : false, l'action est libre et ses politiques, gardées, ne s'appliquent pas.
  enforced boolean not null default true
);

comment on table public.usage_actions is
  'Les actions que le serveur sait gouverner (étiquettes @UsageAction), chacune avec son interrupteur. Voir '
  'docs/adr/0010-politiques-d-usage.md.';
comment on column public.usage_actions.enforced is
  'false : l''action est libre, ses politiques restent en base sans s''appliquer. On rallume sans rien perdre.';

create table public.usage_policies (
  action text not null references public.usage_actions (action) on update cascade on delete cascade,
  -- Les rôles connus du serveur (ROLES, libs/user) : un nouveau rôle s'ajoute aux deux.
  role text not null constraint usage_policies_role_check check (role in ('standard', 'premium', 'admin')),
  -- Nombre de fois par période ; null : sans limite ; 0 : aucune.
  quota integer constraint usage_policies_quota_check check (quota is null or quota >= 0),
  -- La fenêtre de comptage, en UTC : lifetime ne repart jamais.
  period text not null default 'lifetime'
    constraint usage_policies_period_check check (period in ('lifetime', 'day', 'month')),
  primary key (action, role)
);

comment on table public.usage_policies is
  'Ce rôle peut faire cette action quota fois par période (null : sans limite). Seuls les rôles listés ont '
  'accès à une action nommée ici ; le plus généreux des rôles d''une personne l''emporte.';

-- Ce que le serveur lit : les politiques des actions dont l'interrupteur est allumé. Les droits sont ceux de
-- qui lit la vue (security_invoker), jamais ceux de son propriétaire.
create view public.usage_policies_in_force with (security_invoker = true) as
  select policy.action, policy.role, policy.quota, policy.period
  from public.usage_policies as policy
  join public.usage_actions as usage_action on usage_action.action = policy.action
  where usage_action.enforced;

comment on view public.usage_policies_in_force is
  'Les politiques en vigueur : celles des actions dont l''interrupteur (usage_actions.enforced) est allumé.';

-- Lues par le serveur seulement (clé secrète), qui ne les modifie jamais : on les change depuis l'éditeur SQL
-- de Supabase. La base donne par défaut tous les droits sur une nouvelle table ou vue ; on les retire tous,
-- puis on rend la seule lecture au serveur. Pour les clients, la RLS sans aucune politique est une seconde
-- barrière.
alter table public.usage_actions enable row level security;
alter table public.usage_policies enable row level security;

revoke all on table public.usage_actions, public.usage_policies, public.usage_policies_in_force
  from anon, authenticated, service_role;

grant select on table public.usage_actions, public.usage_policies, public.usage_policies_in_force
  to service_role;

-- Ce qu'Apex gouverne aujourd'hui : les messages à Akari. Trois au total pour un compte standard, sans limite
-- pour premium et admin.
insert into public.usage_actions (action, description) values
  ('assistant.send-message', 'Envoyer un message à Akari : chaque message lance un tour de l''assistant.');

insert into public.usage_policies (action, role, quota, period) values
  ('assistant.send-message', 'standard', 3, 'lifetime'),
  ('assistant.send-message', 'premium', null, 'lifetime'),
  ('assistant.send-message', 'admin', null, 'lifetime');
