# ADR 0001 — Workspace Nx, NestJS 12, build et tests avec Vite

- Statut : accepté
- Date : 2026-10-25

## Contexte

Apex Brain reprend les libs d'Apex (`libs/*`, `worklfows/ai-assistant`) et doit les exposer en
API. Apex est un monorepo Nx 23 en TypeScript 6, testé avec Vitest. Les libs du domaine sont du
TypeScript sans framework.

## Décision

- **Nx 23** (même version majeure qu'Apex) avec la même convention d'alias `@org/<lib>` : le code
  porté garde ses imports, et les deux dépôts migrent ensemble avec `nx migrate`. `@nx/nest`
  n'est pas installé : ses générateurs ne visent pas encore Nest 12, et la structure est écrite
  à la main.
- **NestJS 12** pour l'application : version majeure courante, paquets ESM, validation par
  Standard Schema (`@Body({ schema })` + `StandardSchemaValidationPipe`) et document OpenAPI
  construit depuis les mêmes schémas zod (`standardSchemaConverter` de `@nestjs/swagger` 12).
- **Workspace en ESM** (`"type": "module"`), Node 22.12+ ou 24.
- **Un seul transformateur pour les tests et le build : Vite 8 (Oxc, Rolldown).** Vitest exécute
  les tests, `vite build` (mode SSR) regroupe l'app et les libs en un fichier
  (`dist/apps/api/main.js`), les paquets npm restant externes. Oxc émet
  `emitDecoratorMetadata` : `@nestjs/swagger` lit les paramètres et les corps des routes, et ce
  que les tests vérifient est ce qui tourne en production. (esbuild, essayé d'abord, n'émet pas
  ces métadonnées : la documentation perdait les corps de requête.)
- **Imports de types explicites dans l'app** (`@typescript-eslint/consistent-type-imports`) :
  avec les métadonnées, un type importé comme une valeur dans la signature d'une méthode décorée
  devient une référence à un export qui n'existe pas.
- **Injection explicite** : chaque paramètre de constructeur d'une classe Nest porte
  `@Inject(Token)`. Le graphe de dépendances se lit dans le code, comme les `deps` des providers
  Angular d'Apex, et ne dépend pas des métadonnées de type.
- **Vitest 4** pour tout, cible `vite:test` comme dans Apex.

## Conséquences

- Les cas d'usage restent des classes TypeScript pures, assemblées par des `useFactory` dans les
  modules Nest : aucun décorateur Nest n'entre dans `libs/`.
- Les adaptateurs (Supabase, Gemini, Firestore) sont tous fournis par un seul module
  (`ProductionAdaptersModule`) ; les tests e2e le remplacent par des doublures en mémoire sans
  toucher aux modules métier.
- `npx nx serve api` reconstruit et relance le serveur à chaque modification
  (`vite build --watch` et `node --watch`).
