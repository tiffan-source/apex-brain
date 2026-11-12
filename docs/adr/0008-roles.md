# ADR 0008 — Rôles : sur la personne, vérifiés à l'entrée de l'API

- Statut : proposé
- Date : 2026-11-12

## Contexte

Apex va distinguer des comptes : un administrateur, un compte premium, un compte de base. Des
routes devront être fermées à qui n'a pas le bon rôle.

Le métier (`objective`, `chat`, `ai`, le workflow) ne sait rien de l'authentification : il reçoit
l'id du propriétaire et ne demande jamais si la personne est connectée
([ADR 0002](./0002-acces-aux-donnees.md), [ADR 0003](./0003-authentification.md)). « Un objectif
est accompli quand tous ses pas le sont » ne dépend pas de qui appelle ; « seul un compte premium
peut faire X » est une politique du système, comme l'authentification. Elle ne doit pas entrer dans
le métier.

Akari écrit après la fin de la requête, sans jeton ([ADR 0002](./0002-acces-aux-donnees.md)) : on
ne peut vérifier les droits de la personne qu'à l'entrée, quand elle lance ou approuve un tour.

## Options

- **Permissions dans les cas d'usage** (`can(actor, 'objective:delete')`) : tous les points
  d'entrée sont couverts, mais chaque cas d'usage change pour une raison qui n'est pas métier, et
  la porte s'ouvre à d'autres préoccupations (journalisation, cache…).
- **Une table rôle → capacités, vérifiée par une garde** : la route dit ce qu'elle exige
  (`assistant:use`). Une notion de plus, utile quand une même liste de rôles se répète sur
  beaucoup de routes ; prématurée avec deux rôles.
- **Des rôles sur la personne, vérifiés par une garde** : la route dit quels rôles l'ouvrent.

## Décision

Des rôles sur la personne, vérifiés à l'entrée de l'API.

- **`libs/user`** (nouveau) porte `User`, sorti de `libs/auth`, et ses rôles :
  `type Role = 'admin' | 'premium'`. « Basique » n'est pas un rôle, c'est l'absence de rôle : pas
  d'état absurde comme `['basic', 'premium']`, et les comptes existants n'ont rien à migrer.
  `auth` dépend de `user`, pas l'inverse : la personne ne sait pas comment on se connecte.
- **Stockage** : `app_metadata.roles` chez Supabase, que seule la clé secrète modifie. Jamais
  `user_metadata`, que la personne réécrit elle-même depuis un client. L'adaptateur les lit dans
  le jeton (`whoAmI`) et à la connexion ; `parseRoles` ignore ce qui n'est pas un rôle connu.
- **Sortie** : `AuthenticatedUserOutput` porte `roles`. `GET /v2/auth/me`, `login`, `register` et
  `refresh` les rendent ; les clients s'en servent pour l'affichage, le serveur reste seul juge.
- **HTTP** : `@Roles(['premium', 'admin'])` réserve une route ou un contrôleur ; un seul des rôles
  suffit, et posé sur une méthode il remplace celui du contrôleur. `RolesGuard`, garde globale
  placée après `AuthGuard`, répond `403 FORBIDDEN`. Sans `@Roles`, rien ne change : toute personne
  connectée passe.
- **Lint** : `user` et `auth` prennent le tag `type:identity`. Les domaines et le workflow ne
  peuvent pas l'importer ; l'infrastructure et l'app le peuvent.

## Conséquences

- Aucune route n'est réservée pour l'instant : les comptes existants, sans rôle, sont des comptes
  de base et gardent tous leurs accès.
- Donner un rôle se fait avec la clé secrète, par SQL ou par l'API d'administration :

  ```sql
  update auth.users
  set raw_app_meta_data = raw_app_meta_data || '{"roles": ["admin"]}'::jsonb
  where email = 'personne@exemple.fr';
  ```

  ou `auth.admin.updateUserById(id, { app_metadata: { roles: ['admin'] } })`.
- Un rôle donné ou retiré compte au prochain renouvellement de session : le jeton d'accès en cours
  garde ses rôles jusqu'à son expiration (une heure au plus), comme après une déconnexion
  ([ADR 0003](./0003-authentification.md)). Après un passage premium, le client renouvelle la
  session.
- Une route réservée documente son `403` (`@ApiResponse({ status: 403, description: 'FORBIDDEN' })`)
  et le teste en e2e.
- Réserver Akari, c'est poser `@Roles` sur `AssistantController` : ses outils n'ont pas de jeton à
  vérifier.
- Un nouveau rôle s'ajoute à `ROLES` (`libs/user`) ; tant qu'il n'y est pas, il est ignoré à la
  lecture.
- Si une même liste de rôles finit par se répéter sur beaucoup de routes, une table rôle →
  capacités pourra venir dans l'app, sans toucher au métier.
- Premium viendra d'un paiement et pourra expirer : il méritera peut-être alors son propre champ
  (offre, échéance) plutôt qu'un rôle.
