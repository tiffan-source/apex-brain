# Apex Brain

Le serveur d'Apex : une API REST NestJS qui délivre toutes les capacités métier d'Apex
(objectifs, étapes, pas, focus du jour, conversation, assistant Akari) au client web et au client
mobile. Un seul dépôt, un seul cerveau : la logique métier, la résolution des dépendances
(Supabase, Gemini, Firebase) et l'orchestrateur XState vivent ici.

- [Plan et état d'avancement](docs/plan.md)
- [Architecture](docs/architecture.md) et [décisions](docs/adr/)
- [Contrat de l'API](docs/api.md) (et `/docs` sur le serveur)

## Démarrer

Prérequis : Node 22.12+ ou 24 (`nvm use`), Docker et la [CLI Supabase](https://supabase.com/docs/guides/local-development)
pour la base locale.

```bash
npm ci
supabase start                       # base locale, migrations de supabase/migrations
supabase status -o env               # API_URL, ANON_KEY, SERVICE_ROLE_KEY
cp apps/api/.env.example apps/api/.env   # puis remplir (voir les commentaires)
npx nx serve api                     # http://localhost:3000, documentation sur /docs
```

En local, `WORKFLOW_STATE_STORE=memory` évite d'avoir besoin de Firestore (l'état des
conversations en cours est alors perdu au redémarrage).

## Commandes

Tout passe par Nx (`npx nx …`), comme dans Apex.

| Tâche | Commande |
|---|---|
| Serveur de développement (reconstruit et relance à chaque modification) | `npx nx serve api` |
| Build de production (`dist/apps/api/main.js`) | `npx nx build api` |
| Tests d'un projet | `npx nx vite:test <projet>` |
| Tous les tests, le lint, les types | `npx nx run-many -t vite:test lint typecheck` |
| Seulement ce qui a changé | `npx nx affected -t vite:test lint typecheck` |
| Intégration contre le Supabase local | `npx nx run api:test-integration` (variables de `supabase status -o env`) |
| Fonction Vercel (`.vercel/output`), puis sa vérification | `npx nx run api:vercel-build` puis `node tools/vercel/smoke-test.mjs` |

Projets : `api`, `chore`, `objective`, `user`, `auth`, `chat`, `ai`, `supabase`, `gemini`,
`firebase`, `ai-assistant`.

## Structure

```text
apps/api/                 Application NestJS : racine de composition et adaptateurs HTTP
libs/chore/               Noyau partagé (Result, CoreError, IdGenerator)
libs/objective|chat/      Domaines : cas d'usage, ports, modèles, queries, erreurs
libs/user|auth/           Identité : la personne, ses rôles, la connexion
libs/ai/                  Capacité générique de génération IA
libs/supabase|gemini|firebase/  Adaptateurs d'infrastructure
workflows/ai-assistant/   Orchestrateur XState de l'assistant
supabase/                 Schéma de la base (migrations)
docs/                     Plan, architecture, décisions, contrat de l'API
```

## Déployer

### Vercel (production)

L'API est une fonction Vercel ([ADR 0009](docs/adr/0009-hebergement-vercel.md)). Chaque push sur
`main` déploie en production, chaque branche a son déploiement de prévisualisation.

- **Projet** : importer le dépôt, préréglage « Other », racine du dépôt. `vercel.json` donne les
  commandes (`npm ci`, puis `npx nx run api:vercel-build`, qui écrit `.vercel/output`) : rien à
  régler dans le tableau de bord.
- **Variables** : celles de `apps/api/.env.example`, avec `NODE_ENV=production`,
  `TRUST_PROXY=true`, `WORKFLOW_STATE_STORE=firestore` et le compte de service Firebase
  (`FIREBASE_PRIVATE_KEY` accepte les `\n` échappés). `PORT` et `HOST` ne servent pas.
  `ASSISTANT_TURN_OWNERSHIP_SECONDS` vient de la fonction elle-même.
- **Fonction** : Node 24, région `fra1`, 300 s au plus (`tools/vercel/build-output.mjs`).
- `GET /health` répond quand la fonction démarre ; `/docs` sert la documentation.

### Serveur Node

`npx nx build api` produit `dist/apps/api/main.js` (et `serverless.js`, l'entrée de Vercel) : le
code de l'app et des libs y est regroupé, les paquets npm restent externes. Sur l'hôte :
`npm ci --omit=dev` à la racine, puis `node dist/apps/api/main.js`, avec la configuration de
`apps/api/.env.example` en variables d'environnement. Un seul processus : laisser
`ASSISTANT_TURN_OWNERSHIP_SECONDS` à 0. `GET /health` sert de sonde de vie.
