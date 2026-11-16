# ADR 0010 — Politiques d'usage : des règles de produit écrites dans des données

- Statut : proposé
- Date : 2026-11-16

## Contexte

Apex veut limiter Akari selon le compte : un compte standard a droit à trois messages, premium et admin
n'ont pas de limite. Plus tard, seuls certains rôles pourront choisir le modèle d'IA. Ces règles viennent
de la stratégie du moment. Elles changeront bien plus souvent que le métier (premium à dix messages par
mois, une offre de lancement…), et certaines disparaîtront.

Ce ne sont pas des règles métier. Sans la limite de trois messages, Akari reste exactement le même
assistant ; sans la demande d'accord avant qu'il écrive, ce serait un autre produit. La demande d'accord
vit donc dans la machine, la limite n'a rien à y faire : comme l'authentification et les rôles
([ADR 0008](./0008-roles.md)), elle s'applique à l'entrée de l'API.

`@Roles` ne suffit pas : il ouvre ou ferme une route, ne compte rien, et changer la liste des rôles demande
un déploiement.

## Décision

### Des actions, et des politiques en base

Une **action d'usage** nomme un geste de la personne qu'on peut gouverner : `assistant.send-message`. Une
route la déclare avec `@UsageAction('assistant.send-message')`. Cette étiquette est neutre (elle vit dans
`apps/api/src/http/`) : elle ne dit rien de la règle.

Les **politiques sont des données**, dans Supabase :

- `usage_actions` : le catalogue des actions (une ligne par étiquette, avec sa description). Une politique ne
  peut nommer qu'une action du catalogue : une faute de frappe est refusée par la base, au lieu de laisser
  l'action libre en silence.
- `usage_policies` : `(action, role, quota, period)`. `quota` est un nombre de fois par période, `null`
  pour sans limite ; `period` vaut `lifetime`, `day` ou `month` (fenêtres UTC).

Le serveur les relit à chaque décision : une ligne changée compte dès la requête suivante, sans déploiement.

### La règle de décision (`allowanceFor`, dans `libs/usage`)

1. Une action qu'aucune politique ne nomme est **libre** : rien n'est vérifié ni compté. Débrancher une
   politique, c'est supprimer ses lignes.
2. Dès qu'une politique la nomme, seuls les rôles listés y ont accès. Pour les autres : `403 FORBIDDEN`,
   comme une route dont aucun rôle de la personne n'ouvre l'accès.
3. Entre les rôles de la personne, le plus généreux l'emporte : sans limite, sinon le plus grand quota, et à
   quota égal la période la plus courte.
4. Quota atteint : `403 QUOTA_EXCEEDED`. Pas `429` : attendre ne débloque rien, sauf à la fin d'une période
   (que `GET /v2/usage` donne).

Il n'y a pas de passe-droit caché : `admin` a ses lignes, comme tout le monde.

### Les compteurs, hors de la base métier

Les compteurs vivent dans Firestore (collection `usage-counters`), pas dans Supabase : ils appartiennent à
la stratégie, pas au métier, et disparaissent avec elle sans migration. Un compteur vaut pour une
personne, une action, le rôle dont elle utilise le quota et une fenêtre de temps (`lifetime`,
`2026-11-16`, `2026-11`).

Seul ce qui est limité est compté. Un compte sans limite ne lit ni n'écrit Firestore, et si premium passe un
jour à dix messages, chacun en a dix à partir de ce moment-là.

### Réserver, puis rendre

- Avant l'action, une **transaction** Firestore prend une unité si le compteur est sous la limite : deux
  envois simultanés ne peuvent pas la dépasser (`409 WORKFLOW_BUSY` ne protège qu'une conversation, et
  chaque objectif a la sienne).
- Si la route échoue (`400`, `404`, `409 WORKFLOW_BUSY`…), l'unité est rendue.
- Un message à Akari répond `202` et le tour se joue après la réponse : l'unité reste **réservée jusqu'à la
  fin du tour**, et un tour arrêté par une panne la rend. On ne fait pas payer une panne de l'IA à quelqu'un
  qui découvre Akari. Pour cela, le workflow publie la fin de chaque tour (`onTurnEnded` : réussi ou en
  panne). C'est le seul ajout au workflow : il annonce un fait et ne sait rien des politiques. La machine
  n'a pas changé.

### Où vit quoi

| Où | Quoi |
|---|---|
| `libs/usage` (tag `type:policy`) | modèles, décision (`allowanceFor`), fenêtres de temps, ports `UsagePolicySource` et `UsageLedger`, `UsageGate` (réserver, décrire l'usage), `HeldReservations` (réservations en attente d'une issue) |
| `libs/supabase` | `SupabaseUsagePolicySource` : lit `usage_policies` |
| `libs/firebase` | `FirestoreUsageLedger` : les compteurs, en transactions |
| `apps/api/src/usage/` | `UsageInterceptor` (intercepteur global), `GET /v2/usage`, l'écoute des fins de tour d'Akari |
| `apps/api/src/http/usage-action.ts` | l'étiquette `@UsageAction` |

`libs/usage` lit les rôles (`libs/user`) et ne voit ni le métier, ni NestJS, ni l'infrastructure. Le
métier, l'identité et les workflows ne peuvent pas l'importer (lint).

L'intercepteur passe après les gardes : seule une personne authentifiée, autorisée par `@Roles` et sous la
limite de débit réserve une unité.

### Le rôle `standard`

`standard` rejoint `admin` et `premium`, et devient le **rôle par défaut** : une personne sans rôle
enregistré est `standard`. Les politiques ont ainsi un nom à viser, et les comptes existants n'ont rien à
migrer. Cette règle remplace « basique n'est pas un rôle » de l'ADR 0008 : `/v2/auth/me` rend
`["standard"]` au lieu de `[]` pour ces comptes.

## Conséquences

- Changer la stratégie s'écrit en SQL, dans l'éditeur de Supabase :

  ```sql
  -- premium : 10 messages par mois
  update public.usage_policies set quota = 10, period = 'month'
  where action = 'assistant.send-message' and role = 'premium';

  -- plus aucune limite sur les messages à Akari
  delete from public.usage_policies where action = 'assistant.send-message';
  ```

- Gouverner une nouvelle action : une ligne dans `usage_actions` (migration), ses politiques, et
  `@UsageAction` sur la route. Pour réserver le choix du modèle à premium et admin : deux lignes sans quota,
  et `standard` reçoit `403 FORBIDDEN`.
- Changer la période d'une politique ouvre une nouvelle fenêtre : passer `standard` de `lifetime` à `month`
  rend trois messages à chacun pour le mois en cours.
- Les compteurs suivent le rôle : redevenir standard après un passage premium retrouve le compteur
  standard, sans nouvel essai.
- Une politique compte dès la requête suivante. Un rôle donné ou retiré compte au prochain renouvellement de
  session, comme le prévoit l'ADR 0008 : il est lu dans le jeton.
- Si Supabase ou Firestore ne répond pas, une action limitée est refusée (`500`) plutôt que laissée libre.
  Une action sans limite ne touche pas Firestore.
- Les réservations qui attendent la fin d'un tour vivent en mémoire, comme les acteurs de l'assistant. Après
  un redémarrage en plein tour, l'unité reste consommée même si le tour finit en panne. Une réservation est
  oubliée (et reste consommée) après 24 heures : accord jamais donné, objectif supprimé en plein tour.
- Une requête refusée par la validation (`400`) réserve puis rend son unité : dans Nest, les intercepteurs
  passent avant les pipes.
- `WORKFLOW_STATE_STORE=memory` garde aussi les compteurs en mémoire (développement : remis à zéro au
  redémarrage).
