# Architecture d'Apex Brain

Apex Brain garde l'architecture hexagonale d'Apex : le métier ne dépend que d'abstractions
(des classes abstraites qui servent de ports), l'infrastructure les implémente, et un seul endroit
assemble le tout. La différence : cet endroit n'est plus l'application Angular, c'est
l'application NestJS `apps/api`.

## Les couches

```text
                    Clients (web Angular, mobile React Native)
                                   │  HTTP + JSON, Bearer
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ apps/api  (type:app)                                                 │
│   contrôleurs ── schémas zod (contrat HTTP) ── gardes ── filtre      │
│   gardes : AuthGuard (qui est-ce ?), puis RolesGuard (@Roles)        │
│   modules métier : assemblent cas d'usage et workflow sur les ports  │
│   abonnés du bus : réagissent aux faits annoncés par les workflows   │
│   ProductionAdaptersModule : branche chaque port sur son adaptateur  │
└──────────────────────────────────────────────────────────────────────┘
     │ connexion, rôles    │ cas d'usage, queries   │ workflow
     ▼                     ▼                        ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│ libs/user  auth  │  │ libs/objective   │◄─│ workflows/ai-assistant   │
│ (type:identity)  │  │ chat  ai         │  │ (type:workflow)          │
│ la personne,     │  │ (type:domain)    │  │ machine XState, outils,  │
│ ses rôles, la    │  │ ne voit que l'id │  │ acteurs ; hébergé par    │
│ connexion        │  │ du propriétaire  │  │ workflows/runtime        │
└──────────────────┘  └──────────────────┘  └──────────────────────────┘
     ▲                     ▲                        ▲ WorkflowStateStore
     │ AuthProvider        │ ports du domaine       │
┌──────────────────────────────────────────────────────────────────────┐
│ libs/supabase   libs/gemini   libs/firebase   (type:infra)           │
└──────────────────────────────────────────────────────────────────────┘
          tout dépend de libs/chore (type:kernel) : Result, CoreError, IdGenerator
```

## La règle de dépendance, vérifiée par le lint

`eslint.config.mjs` configure `@nx/enforce-module-boundaries` d'après les tags des projets :

| Tag | Projets | Peut dépendre de | Ne peut pas importer |
|---|---|---|---|
| `type:kernel` | `chore` | rien | SDK d'infrastructure, NestJS |
| `type:domain` | `objective`, `chat`, `ai` | `type:kernel` | un autre domaine, l'identité, l'infrastructure, NestJS |
| `type:identity` | `user`, `auth`, `akari-access` | `type:identity`, `type:kernel` | le métier, l'infrastructure, NestJS |
| `type:runtime` | `workflow-runtime`, `event-bus` | `type:runtime`, `type:kernel` | le métier, l'identité, l'infrastructure, NestJS |
| `type:workflow` | `ai-assistant` | `type:domain`, `type:runtime`, `type:kernel` | l'identité, l'infrastructure, NestJS |
| `type:infra` | `supabase`, `gemini`, `firebase` | `type:domain`, `type:identity`, `type:workflow`, `type:runtime`, `type:kernel` | — |
| `type:app` | `api` | tout | — |

Le métier ne voit jamais la personne ni ses rôles : il ne reçoit que l'id du propriétaire
([ADR 0002](./adr/0002-acces-aux-donnees.md)), et les rôles sont vérifiés à l'entrée de l'API
([ADR 0008](./adr/0008-roles.md)). `auth` dépend de `user`, jamais l'inverse ; `akari-access`
(les droits Akari de chaque rôle) aussi.

Les doublures de test (`@org/<lib>/testing`) ne peuvent être importées que par des tests. Les
lectures BFF (`@org/<lib>/bff`) ne peuvent être importées que par l'infrastructure qui les
implémente et par l'app qui les expose (`allowBffImports` dans leur `eslint.config.mjs`) ; dans un
domaine, rien hors du dossier `bff/` ne les lit.

## Où vit quoi

- **Cas d'usage (commandes)** : `libs/<domaine>/src/lib/usecases/*.usecase.ts`. Un cas d'usage =
  un geste nommé (`RenameObjective`, `CompleteTask`…), jamais une modification générique ; il rend
  l'entité créée ou modifiée ([ADR 0006](./adr/0006-commandes-et-bff.md)). Ils rendent un
  `Result<T>` construit par `runWithResult` ; seules les erreurs du domaine listées deviennent
  des échecs structurés, le reste devient `UNKNOWN_ERROR`. Les cas d'usage sont **réservés au
  métier**, aux gestes des personnes qui utilisent Apex : un mécanisme du système qui contrôle ou
  compte ce qu'elles font (droits, quotas, journal d'usage) n'en a pas. Il expose un service et des
  ports, et rend ses refus comme des décisions, pas comme des erreurs (`libs/akari-access`).
- **Lectures BFF** : `libs/<domaine>/src/lib/bff/*.query.ts`, exportées par `src/bff.ts`
  (`@org/<domaine>/bff`). Des ports pour les clients web et mobile, sans cas d'usage ni logique
  métier, implémentés directement par l'infrastructure et exposés sous `/v2/bff` (tag `bff`).
- **Queries** : `libs/<domaine>/src/lib/queries/*.query.ts`, des ports sans logique métier (voir
  [`technical/queries.md`](./technical/queries.md)).
- **Ports** : `protocols/*.ts` (repositories, fournisseurs). Chaque port reçoit le propriétaire
  ([ADR 0002](./adr/0002-acces-aux-donnees.md)).
- **Rôles** : `Role`, `parseRoles` et `hasAnyRole` dans `libs/user` ; lus par l'adaptateur
  Supabase dans `app_metadata.roles` ; vérifiés par `RolesGuard` sur les routes marquées
  `@Roles([...])` ([ADR 0008](./adr/0008-roles.md)).
- **Quota d'Akari** : `libs/akari-access`, un service du système (`AkariAccess`) et ses ports
  (`AkariRuleSource` pour les règles des rôles, `AkariUsageJournal` pour le journal des tours
  réussis, `Clock`). `AkariAccess.check` décide (`decideAkariAccess`, pure) dans `AkariQuotaGuard`,
  sur l'envoi d'un message ; `AkariAccess.record` compte un tour, abonné du bus à
  `ai-assistant.turn.succeeded` (`AssistantSubscribers`). Le workflow ne connaît ni rôles ni quotas.
- **Adaptateurs** : `libs/supabase`, `libs/gemini`, `libs/firebase`.
- **Workflow de l'assistant** : `workflows/ai-assistant` ([ADR 0004](./adr/0004-orchestrateur.md),
  [PRD](./features/send-message-to-ai-prd.md)) : la machine, ses ports, et les règles d'une requête
  (`SendMessageToAIWorkflow`). `aiAssistantWorkflow(…)` la confie au runtime.
- **Runtime des workflows** : `workflows/runtime` ([ADR 0010](./adr/0010-runtime-des-workflows-et-bus-d-evenements.md)).
  Il héberge les instances d'un workflow, une par clé (l'objectif) : création ou restauration,
  sauvegarde ordonnée de chaque transition par le port `WorkflowStateStore` (Firestore,
  `libs/firebase`), éviction des instances au repos, arrêt, oubli. Il est le seul à écouter les faits
  que la machine annonce (`emit`) : il les enveloppe et les publie dans le bus, après avoir sauvegardé
  l'état qui les a produits.
- **Bus d'événements** : `libs/event-bus`, le port `EventBus` et sa version en mémoire. Un fait porte
  son type (`ai-assistant.turn.succeeded`), sa source, sa clé, son propriétaire, son `audience`
  (`public`, vers le client de la personne ; `internal`, jamais hors du serveur) et sa charge. Les
  réactions de l'API sont des abonnés (`apps/api/src/assistant/assistant.subscribers.ts` : le
  comptage d'usage d'Akari, la journalisation des pannes de tour). Au plus une fois : un fait peut se
  perdre si le serveur tombe entre la sauvegarde et la publication.
- **Racine de composition** : `apps/api/src/adapters/production-adapters.module.ts` (ports →
  adaptateurs) et `apps/api/src/<contexte>/<contexte>.module.ts` (cas d'usage ← ports).
- **Contrat HTTP** : `apps/api/src/<contexte>/*.schemas.ts` (zod) ; les mêmes schémas valident
  les requêtes, documentent l'API (OpenAPI) et vérifient les réponses dans les tests e2e.

## Ajouter un cas d'usage, de bout en bout

1. **Domaine** : écrire le cas d'usage dans `libs/<domaine>/src/lib/usecases/`, ses erreurs dans
   `errors/`, l'exporter dans `src/index.ts`. S'il lui faut un nouveau port, l'ajouter dans
   `protocols/` avec l'`ownerId` dans sa signature.
2. **Test unitaire** : à côté du cas d'usage, avec les doublures de `src/lib/testing/`
   (compléter la doublure si le port change).
3. **Adaptateur** : implémenter le port dans `libs/supabase` (filtre `user_id`, ordre stable) et
   l'éprouver dans `libs/supabase/src/integration/`.
4. **Composition** : brancher l'adaptateur dans `ProductionAdaptersModule` (et l'ajouter à
   `PORTS` s'il s'agit d'un nouveau port), puis construire le cas d'usage dans le module du
   contexte avec `useFactory`/`inject`.
5. **HTTP** : schémas zod de la requête et de la réponse dans `<contexte>.schemas.ts`, route dans
   le contrôleur v2 (`@Inject` explicite, `unwrap(await usecase.execute(...))`), nommée comme la
   commande : `@ApiOperation({ operationId: 'renameObjective' })` sur
   `PATCH /v2/objectives/{id}/rename` (`PATCH` pour une modification, `POST` pour une création,
   `DELETE` pour une suppression). Statut HTTP des nouveaux codes d'erreur dans
   `apps/api/src/http/api-error.ts`.
6. **Test e2e** : `apps/api/test/<contexte>.e2e.spec.ts`, y compris l'isolation entre deux personnes.
7. **Contrat** : mettre à jour [`api.md`](./api.md).

## Les tests

| Niveau | Où | Ce qu'ils remplacent | Commande |
|---|---|---|---|
| Unitaires | `libs/*/src/**/*.spec.ts`, `workflows/*/src/**/*.spec.ts` | toute l'infrastructure (doublures en mémoire) | `npx nx run-many -t vite:test` |
| e2e HTTP | `apps/api/test/*.e2e.spec.ts` | Supabase, Gemini, Firestore | `npx nx vite:test api` |
| Intégration | `libs/supabase/src/integration/`, `apps/api/test/integration/` | Gemini (IA scriptée), Firestore (mémoire) | `npx nx run api:test-integration` et `SUPABASE_INTEGRATION=1 npx nx vite:test supabase`, après `supabase start` |

Les doublures en mémoire suivent les règles des vrais adaptateurs (filtre par propriétaire,
refus d'écraser la ligne d'un autre, un même id deux fois dans une écriture refusé comme par
Postgres, ordre de création) : un cas d'usage qui passe ses tests unitaires se comporte de la
même façon sur Supabase. Les tests d'intégration le vérifient.
