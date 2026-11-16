-- Politiques d'usage : qui peut faire quelle action d'Apex, et combien de fois
-- (docs/adr/0010-politiques-d-usage.md).
--
-- Des règles de produit, pas des règles métier : elles changent avec la stratégie, sans déploiement. Le
-- serveur relit ces tables à chaque décision, si bien qu'une ligne changée compte dès la requête suivante.
-- Une action qu'aucune politique ne nomme est libre ; débrancher une politique, c'est supprimer ses lignes.
-- Les compteurs vivent hors de cette base (Firestore, collection usage-counters).

-- Le catalogue des actions que le serveur sait gouverner : une par étiquette @UsageAction du code. Une
-- politique ne peut nommer qu'une action d'ici : une faute de frappe est refusée au lieu de laisser l'action
-- libre en silence.
create table public.usage_actions (
  action text primary key,
  description text not null
);

comment on table public.usage_actions is
  'Les actions que le serveur sait gouverner (étiquettes @UsageAction). Voir docs/adr/0010-politiques-d-usage.md.';

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

-- Lues par le serveur seulement (clé secrète) : aucun client ne les lit ni ne les modifie. On les change
-- depuis l'éditeur SQL de Supabase.
alter table public.usage_actions enable row level security;
alter table public.usage_policies enable row level security;

grant select on table public.usage_actions to service_role;
grant select on table public.usage_policies to service_role;

-- Ce qu'Apex gouverne aujourd'hui : les messages à Akari. Trois au total pour un compte standard, sans limite
-- pour premium et admin.
insert into public.usage_actions (action, description) values
  ('assistant.send-message', 'Envoyer un message à Akari : chaque message lance un tour de l''assistant.');

insert into public.usage_policies (action, role, quota, period) values
  ('assistant.send-message', 'standard', 3, 'lifetime'),
  ('assistant.send-message', 'premium', null, 'lifetime'),
  ('assistant.send-message', 'admin', null, 'lifetime');
