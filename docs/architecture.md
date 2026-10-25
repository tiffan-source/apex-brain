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
│ apps/api  (type:app)                                                  │
│   contrôleurs ── schémas zod (contrat HTTP) ── garde d'auth ── filtre  │
│   modules métier : assemblent cas d'usage et workflow sur les ports    │
│   ProductionAdaptersModule : branche chaque port sur son adaptateur    │
└──────────────────────────────────────────────────────────────────────┘
          │ cas d'usage, queries            │ workflow
          ▼                                 ▼
┌───────────────────────────┐   ┌──────────────────────────────────────┐
│ libs/objective  auth  chat │◄──│ workflows/ai-assistant (type:workflow)│
│ libs/ai     (type:domain)  │   │   machine XState, outils, acteurs     │
└───────────────────────────┘   └──────────────────────────────────────┘
          ▲  ports (classes abstraites)        ▲ IWorkflowStateRepository
          │                                    │
┌──────────────────────────────────────────────────────────────────────┐
│ libs/supabase   libs/gemini   libs/firebase   (type:infra)            │
└──────────────────────────────────────────────────────────────────────┘
          tout dépend de libs/chore (type:kernel) : Result, CoreError, IdGenerator
```

## La règle de dépendance, vérifiée par le lint

`eslint.config.mjs` configure `@nx/enforce-module-boundaries` d'après les tags des projets :

| Tag | Projets | Peut dépendre de | Ne peut pas importer |
|---|---|---|---|
| `type:kernel` | `chore` | rien | SDK d'infrastructure, NestJS |
| `type:domain` | `objective`, `auth`, `chat`, `ai` | `type:kernel` | un autre domaine, l'infrastructure, NestJS |
| `type:workflow` | `ai-assistant` | `type:domain`, `type:kernel` | l'infrastructure, NestJS |
| `type:infra` | `supabase`, `gemini`, `firebase` | `type:domain`, `type:workflow`, `type:kernel` | — |
| `type:app` | `api` | tout | — |

Les doublures de test (`@org/<lib>/testing`) ne peuvent être importées que par des tests.

## Où vit quoi

- **Cas d'usage** : `libs/<domaine>/src/lib/usecases/*.usecase.ts`. Ils rendent un
  `Result<T>` construit par `runWithResult` ; seules les erreurs du domaine listées deviennent
  des échecs structurés, le reste devient `UNKNOWN_ERROR`.
- **Queries** : `libs/<domaine>/src/lib/queries/*.query.ts`, des ports sans logique métier (voir
  [`technical/queries.md`](./technical/queries.md)).
- **Ports** : `protocols/*.ts` (repositories, fournisseurs). Chaque port reçoit le propriétaire
  ([ADR 0002](./adr/0002-acces-aux-donnees.md)).
- **Adaptateurs** : `libs/supabase`, `libs/gemini`, `libs/firebase`.
- **Workflow de l'assistant** : `workflows/ai-assistant` ([ADR 0004](./adr/0004-orchestrateur.md),
  [PRD](./features/send-message-to-ai-prd.md)).
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
   le contrôleur (`@Inject` explicite, `unwrap(await usecase.execute(...))`), statut HTTP des
   nouveaux codes d'erreur dans `apps/api/src/http/api-error.ts`.
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
