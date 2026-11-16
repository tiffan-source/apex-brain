# Plan — Apex Brain

Apex Brain est le serveur unique d'Apex : une application NestJS qui expose en API REST les
capacités métier d'Apex (cas d'usage, queries, assistant IA) au client web Angular et au futur
client mobile React Native. Un seul dépôt, un seul cerveau : la logique métier, la résolution des
dépendances (Supabase, Gemini ou Claude, Firebase) et l'orchestrateur XState vivent ici.

Ce document décrit ce qui a été repris d'Apex, ce qui a été amélioré ou corrigé en chemin, et ce
qui reste à faire. Les décisions structurantes sont détaillées dans [`docs/adr/`](./adr).

## 1. Point de départ

Dans Apex (dépôt `tiffan-source/apex`), tout s'exécutait dans le navigateur :

- les cas d'usage (`libs/objective`, `libs/auth`, `libs/chat`) étaient injectés dans les stores
  Angular par `apps/apex-client/src/chore/providers/*.ts` ;
- Supabase était appelé directement par le client, protégé par la RLS ;
- Gemini passait par une edge function Supabase (`httpGeminiInteractiveAiProvider`) ;
- l'orchestrateur XState (`worklfows/ai-assistant`) tournait dans l'onglet, persisté dans
  Firestore avec le SDK client.

## 2. Cible

```text
apex-brain/
├── apps/api/                 Application NestJS : racine de composition + adaptateurs HTTP
├── libs/chore/               Noyau partagé : Result, runWithResult, CoreError, IdGenerator
├── libs/objective/           Domaine objectifs / étapes / pas
├── libs/auth/                Authentification (identité)
├── libs/user/                La personne et ses rôles (identité)
├── libs/chat/                Domaine conversation
├── libs/ai/                  Capacité générique de génération IA (port)
├── libs/supabase/            Adaptateurs Supabase (données + auth)
├── libs/gemini/              Adaptateur Gemini (SDK @google/genai)
├── libs/claude/              Adaptateur Claude (SDK @anthropic-ai/sdk)
├── libs/firebase/            Adaptateur Firestore (état des workflows, historique de Claude)
├── workflows/ai-assistant/   Orchestrateur XState « envoyer un message à l'IA »
└── supabase/                 Schéma de la base (migrations), désormais source de vérité
```

La règle de dépendance d'Apex est conservée et **vérifiée par le lint** (tags Nx, voir
[`docs/architecture.md`](./architecture.md)) : le domaine ne connaît que le noyau, le workflow ne
connaît que le domaine, l'infrastructure implémente les ports, et seule l'application assemble
le tout.

## 3. Inventaire : ce que le serveur expose

Seules les capacités que les clients consomment deviennent des endpoints. Les repositories,
`ObjectiveInternalService`, `AddMessageCommand`, les outils de l'assistant et les ports d'IA
restent internes.

| Capacité dans Apex | Nature | Endpoint |
|---|---|---|
| `CreateNewUserUseCase` | cas d'usage | `POST /v1/auth/register` |
| `LogUserInUseCase` | cas d'usage | `POST /v1/auth/login` |
| `RefreshSessionUseCase` *(nouveau)* | cas d'usage | `POST /v1/auth/refresh` |
| `LogUserOutUseCase` *(nouveau)* | cas d'usage | `POST /v1/auth/logout` |
| `GetCurrentUserUseCase` | cas d'usage | `GET /v1/auth/me` |
| `GetMyObjectivesUsecase` *(nouveau)*, sur `GetAllObjectiveAndTaskQuery` | cas d'usage | `GET /v1/objectives` |
| `CreateObjectiveUsecase` | cas d'usage | `POST /v1/objectives` |
| `EditObjectiveUsecase` | cas d'usage | `PATCH /v1/objectives/{objectiveId}` |
| `AddSubObjectiveUsecase` | cas d'usage | `POST /v1/objectives/{objectiveId}/sub-objectives` |
| `AddTaskToObjectiveUsecase` | cas d'usage | `POST /v1/objectives/{objectiveId}/tasks` |
| `EditMyTaskUsecase` | cas d'usage | `PATCH /v1/tasks/{taskId}` |
| `UpdateDoneStatusOfTaskUsecase` | cas d'usage | `PUT /v1/tasks/{taskId}/done` |
| `DeleteObjectiveUsecase` *(nouveau)* | cas d'usage | `DELETE /v1/objectives/{objectiveId}` |
| `DeleteTaskUsecase` *(nouveau)* | cas d'usage | `DELETE /v1/tasks/{taskId}` |
| `WhatIsTodayFocusUsecase` | cas d'usage | `GET /v1/tasks/today-focus` |
| `GetConversationsQuery` | query | `GET /v1/objectives/{objectiveId}/conversation` |
| `SendMessageToAIWorkflow.startWorkFlow` + `getState` | workflow | `GET /v1/objectives/{objectiveId}/assistant` |
| `SendMessageToAIWorkflow.sendMessage` | workflow | `POST /v1/objectives/{objectiveId}/assistant/messages` |
| `SendMessageToAIWorkflow.respondToPermission` | workflow | `POST /v1/objectives/{objectiveId}/assistant/permission` |

`RefreshSessionUseCase` et `LogUserOutUseCase` sont nouveaux : dès que l'authentification passe
par le serveur, les clients doivent pouvoir renouveler un jeton expiré et fermer une session sans
parler à Supabase. La déconnexion figurait déjà dans les cas d'usage manquants du `TODO.md` d'Apex.

`DeleteObjectiveUsecase` et `DeleteTaskUsecase` sont nouveaux eux aussi : une seule route supprime
un objectif ou une étape, comme les commandes de modification valent pour l'un ou l'autre. Il n'y
a pas de règle métier : la propriété borne la suppression, et les `ON DELETE CASCADE` de la base
emportent étapes, pas, conversation et messages. L'état de l'assistant vit dans Firestore, hors de
cette cascade : la route met fin au workflow (`SendMessageToAIWorkflow.forget`) une fois l'objectif
supprimé. C'est pour cela que `ObjectivesModule` importe `AssistantModule`, et que
`ObjectiveInternalService`, dont seul l'assistant se sert, est construit dans ce dernier.

Ce tableau est celui de la **v1**, retirée le 8 novembre 2026
([ADR 0007](./adr/0007-retrait-de-la-v1.md)) : il reste comme trace du portage. La **v2**
([ADR 0006](./adr/0006-commandes-et-bff.md)) sépare les commandes des lectures pour les clients :

| v2 | Nature | Endpoint |
|---|---|---|
| `CreateObjectiveUsecase`, `AddSubObjectiveUsecase`, `AddTaskToObjectiveUsecase` | commandes | `POST /v2/objectives`, `…/{objectiveId}/sub-objectives`, `…/{objectiveId}/tasks` |
| `RenameObjectiveUsecase`, `ClarifyObjectiveUsecase`, `SetObjectiveDeadlineUsecase`, `RemoveObjectiveDeadlineUsecase` *(remplacent `EditObjectiveUsecase`)* | commandes | `PATCH /v2/objectives/{objectiveId}/rename`, `/clarify`, `/set-deadline`, `/remove-deadline` |
| `RenameTaskUsecase`, `ReprioritizeTaskUsecase`, `MoveTaskUsecase` *(remplacent `EditMyTaskUsecase`)* | commandes | `PATCH /v2/tasks/{taskId}/rename`, `/reprioritize`, `/move` |
| `CompleteTaskUsecase`, `ReopenTaskUsecase` *(remplacent `UpdateDoneStatusOfTaskUsecase`)* | commandes | `PATCH /v2/tasks/{taskId}/complete`, `/reopen` |
| `DeleteObjectiveUsecase`, `DeleteTaskUsecase` | commandes | `DELETE /v2/objectives/{objectiveId}`, `DELETE /v2/tasks/{taskId}` |
| `WhatIsTodayFocusUsecase` | cas d'usage | `GET /v2/tasks/today-focus` |
| `GetObjectiveTreeQuery` *(remplace `GetMyObjectivesUsecase`)* | lecture BFF | `GET /v2/bff/objective-tree` |

L'authentification, la conversation et l'assistant répondent sous `/v2` (les mêmes routes que la v1,
autre préfixe).

Le contrat détaillé (corps, réponses, codes d'erreur) est dans [`docs/api.md`](./api.md) ; le
document OpenAPI est servi par l'API sur `/docs` et `/docs-json`.

## 4. Améliorations d'architecture

1. **Propriété explicite** ([ADR 0002](./adr/0002-acces-aux-donnees.md)). Le serveur accède à
   Supabase avec la clé secrète : chaque lecture et chaque écriture des ports du domaine reçoit
   l'`ownerId`, et les adaptateurs filtrent sur `user_id`. Sans cela, un utilisateur pouvait
   modifier l'objectif d'un autre en connaissant son id, et un `save` aurait même réécrit le
   `user_id` de tout le sous-arbre. La RLS reste active en base pour tout accès direct.
2. **Authentification sans état** ([ADR 0003](./adr/0003-authentification.md)). Le port
   `AuthProvider` ne suppose plus une session stockée dans le client : `register`, `login`,
   `refresh`, `logout(accessToken)`, `whoAmI(accessToken)`. Les jetons sont vérifiés par
   `auth.getClaims()` (vérification locale avec les clés asymétriques, repli sur le serveur
   d'auth sinon). Les erreurs reçoivent des codes stables (`INVALID_CREDENTIALS`,
   `USER_ALREADY_EXIST`, `WEAK_PASSWORD`, `EMAIL_NOT_CONFIRMED`, `INVALID_SESSION`) : le client
   n'aura plus à traduire les textes anglais de Supabase.
3. **IA dans le serveur**. L'adaptateur Gemini appelle le SDK directement (API Interactions, comme
   l'edge function), traduit les erreurs du SDK en `AIProviderError` et reçoit le modèle par la
   configuration. L'edge function, appelable sans authentification, n'a plus lieu d'être.
4. **Contexte système** (PRD § 11). L'id de l'objectif n'est plus collé à la fin du message de
   l'utilisateur : un `SystemContextProvider` construit les instructions système (rôle d'Akari,
   objectif concerné, règles), transmises au port d'IA par le champ `systemInstruction`.
5. **Frontières vérifiées**. `libs/ai` ne réexporte plus le modèle de `libs/chat` ; le lint
   interdit les dépendances entre domaines et l'import de SDK d'infrastructure dans le domaine.
6. **Firestore côté serveur**. `firebase-admin` remplace le SDK client : les règles Firestore
   pourront tout refuser aux navigateurs (aujourd'hui elles doivent laisser n'importe quel client
   écrire dans `workflow-states`).
7. **Identifiants**. `crypto.randomUUID()` remplace `Math.random()`.
8. **Commandes et lectures BFF** ([ADR 0006](./adr/0006-commandes-et-bff.md)). Les cas d'usage
   sont des commandes nommées d'après le geste de la personne (plus de `PATCH` générique) et rendent
   l'entité modifiée. Les lectures pour les clients sont des ports BFF rangés dans le dossier `bff/`
   du domaine (`@org/objective/bff`), implémentés par Supabase, interdits aux commandes et à Akari
   par le lint. Servi en v2 ; la v1 a été retirée ([ADR 0007](./adr/0007-retrait-de-la-v1.md)).

## 5. Corrections (bugs constatés dans Apex)

| Où | Problème | Correction |
|---|---|---|
| `SupabaseObjectiveRepository.findObjectiveWithASpecificTaskId` | Les pas sont reconstruits sans `done`, `description` ni `dueDate` : modifier ou déplacer un pas remet ses voisins à « non faits » en base (TODO d'Apex). | Les pas passent par `TaskMapper.toDomain`. |
| `EditMyTaskUsecase` | Pas introuvable signalé en `OBJECTIVE_NOT_FOUND` avec l'id du pas ; `ObjectiveNotFoundError` et l'échec d'enregistrement absents des erreurs attendues (donc `UNKNOWN_ERROR`) ; résultat de `save` ignoré. | `TASK_NOT_FOUND`, erreurs attendues complètes, `FAIL_TO_SAVE_OBJECTIVE` vérifié. |
| `AddSubObjectiveUsecase`, `AddTaskToObjectiveUsecase` | Un `save` qui échoue passe pour un succès. | `FAIL_TO_SAVE_OBJECTIVE`. |
| `SupabaseTaskRepository.findById` | `.single()` lève quand le pas n'existe pas : `UNKNOWN_ERROR` au lieu de `TASK_NOT_FOUND`. | `.maybeSingle()`. |
| Chargement des objectifs, `get_objective_subtree`, messages | Aucun `ORDER BY` : l'ordre change à chaque écriture (TODO d'Apex). | Tri stable `created_at`, puis `id`. |
| `SupabaseAddMessageCommand` | `createdAt` inventé (`new Date()`) au lieu de la valeur en base. | La ligne insérée est relue. |
| `WhatIsTodayFocusUsecase` | Une requête par pas pour retrouver son objectif (N+1). | `Task.objectiveId`, posé par `Objective.addTask` comme `parentId` l'est par `addSubObjective`. |
| Workflow : restauration | Un workflow persisté en plein tour (rechargement, redémarrage) est restauré par `resolveState` sans relancer l'étape invoquée : il reste bloqué pour toujours (vérifié). | Persistance du snapshot complet (`getPersistedSnapshot`), qui relance l'étape interrompue ; ids de message posés avant l'écriture pour qu'une reprise ne double pas un message. |
| Workflow : erreurs | `registerMessage`, `generateResponse`, `sendToolCallResult` n'ont pas d'`onError` : un échec de Gemini ou de Supabase bloque le tour (TODO d'Apex). | Retour au repos avec `lastError`, la personne peut réessayer. |
| Workflow : persistance | Les sauvegardes partent en parallèle : une ancienne peut écraser une plus récente. | Une file par workflow, sauvegardes dans l'ordre. |
| Workflow : envois concurrents | Un message envoyé pendant un tour est ignoré en silence. | `409 WORKFLOW_BUSY`. |
| Workflow : inspecteur | `createBrowserInspector` appelé à chaque démarrage (TODO d'Apex). | Inspection injectable, désactivée par défaut. |
| Workflow : mémoire | Un acteur par objectif ouvert, jamais libéré. | Les acteurs au repos sont libérés après un délai (ils sont persistés). |
| `EditObjectiveUsecase` | Impossible de retirer une échéance (TODO d'Apex). | `dueDate: null` la retire. |
| `EditMyTaskUsecase` | Remonter un pas d'une étape vers son objectif échoue : l'arbre enregistré porte deux fois le même pas, et Postgres refuse l'upsert (trouvé par les tests d'intégration). | Le pas est retiré de son ancienne place dans l'arbre d'arrivée. |
| Workflow : outils | Les outils et les instructions ne repartent pas avec les résultats d'outils, alors que l'API Interactions de Gemini ne garde que l'historique : l'IA ne peut pas enchaîner deux outils dans un tour. | Outils et instructions renvoyés à chaque échange. |
| Workflow : résultats d'outils | La remise à zéro des résultats était posée dans `invoke` (où XState l'ignore) : une deuxième série d'outils renvoyait aussi les résultats de la première. | Remise à zéro à la sortie de l'état. |
| Workflow : arguments d'outils | Des arguments mal formés font lever l'outil, et l'IA reçoit un message générique. | L'IA reçoit les champs refusés (`INVALID_ARGUMENTS`) et peut se corriger. |
| Migrations | Aucun `GRANT` : Supabase n'expose plus automatiquement les nouvelles tables, une base recréée refuse tout accès. | Migration `20261025120000_explicit_data_api_grants.sql`. |

Les queries suivent toujours la règle d'Apex (pas de logique métier), avec un écart assumé : une
panne d'infrastructure remonte comme une erreur technique (`500`) au lieu d'un résultat vide, qui
ferait afficher « aucun objectif » au client. C'est ce que faisaient déjà les implémentations
Supabase d'Apex ; [`docs/technical/queries.md`](./technical/queries.md) est mis à jour.

## 6. Phases

### Phase 0 — Fondations
- [x] Workspace Nx 23 (même version majeure qu'Apex), TypeScript 6, ESLint 10, Prettier.
- [x] Frontières de modules par tags (`type:kernel|domain|workflow|infra|app`) et imports
      d'infrastructure interdits dans le domaine.
- [x] Vitest 4 pour tout (cible `vite:test`, comme Apex) ; build de l'API par Vite 8, le même
      transformateur que les tests ([ADR 0001](./adr/0001-workspace-et-outillage.md)).
- [x] CI GitHub Actions : lint, typecheck, tests, build ; intégration contre un Supabase local.
- [x] `CLAUDE.md`, `README.md`, documentation d'architecture, contrat de l'API et ADR.

### Phase 1 — Domaine
- [x] `libs/chore` porté, générateur d'ids `crypto.randomUUID()`.
- [x] `libs/objective` porté avec la propriété explicite et les corrections du § 5.
- [x] `libs/auth` repensé sans état, avec ses codes d'erreur.
- [x] `libs/chat` et `libs/ai` portés, frontières nettoyées.
- [x] Tests unitaires de chaque cas d'usage avec des doublures en mémoire (point d'entrée
      `@org/<lib>/testing`).

### Phase 2 — Infrastructure
- [x] `libs/supabase` : client de données (clé secrète), clients d'auth éphémères, filtres de
      propriété, tri, corrections de mapping.
- [x] `libs/gemini` : SDK direct, traduction des erreurs.
- [x] `libs/claude` : SDK Anthropic direct (API Messages), historique des interactions gardé côté
      serveur (Firestore ou mémoire), cache de prompt, traduction des erreurs ; choix du fournisseur
      par `AI_PROVIDER` ([ADR 0009](./adr/0009-fournisseur-claude.md)).
- [x] `libs/firebase` : `firebase-admin`, contexte et snapshot en JSON, anciens documents lisibles.
- [x] `supabase/` : migrations reprises d'Apex (sans l'edge function), plus les `GRANT` explicites.

### Phase 3 — Orchestrateur
- [x] `workflows/ai-assistant` (le dossier perd sa coquille `worklfows`) : machine XState
      reprise, corrections du § 5, contrôle de propriété, état exposé sous une forme stable.
- [x] Tests de la machine : réponse texte, outil de lecture, outil d'écriture accepté et refusé,
      outil inconnu, panne de l'IA, reprise après redémarrage, document écrit par Apex.

### Phase 4 — API
- [x] Racine de composition NestJS : un module d'adaptateurs, un module par contexte (`auth`,
      `objectives`, `conversation`, `assistant`).
- [x] Garde d'authentification globale, `@Public()`, `@CurrentUser()`.
- [x] Validation zod (Standard Schema de Nest 12), erreurs `{ error: { code, message } }`.
- [x] OpenAPI généré depuis les mêmes schémas zod (`/docs`, `/docs-json`).
- [x] Configuration validée au démarrage, santé, CORS, en-têtes de sécurité, limitation de débit.

### Phase 5 — Vérification
- [x] Tests e2e HTTP de chaque endpoint avec les doublures en mémoire (dont l'isolation entre
      deux utilisateurs).
- [x] Tests d'intégration contre un vrai Supabase (Postgres, PostgREST, GoTrue) : activés par
      `SUPABASE_INTEGRATION=1`, lancés par la CI après `supabase start`.

## 7. Après ce dépôt

- **Client web** : remplacer les providers de `apps/apex-client/src/chore/providers/*.ts` par
  des adaptateurs HTTP qui implémentent les mêmes ports (les stores ne changent pas), puis
  retirer de l'app les libs d'infrastructure, `env.ts` (clés Gemini, Firebase, Supabase) et
  l'edge function.
- **Client mobile** : générer un client typé depuis `/docs-json`.
- **Base de données** : lancer Supabase depuis `apex-brain` et retirer `supabase/` d'Apex une
  fois le client migré ; verrouiller les règles Firestore (le navigateur n'y écrit plus).
- **Assistant** : remplacer l'interrogation chaque seconde par un flux SSE.
- **Rôles** ([ADR 0008](./adr/0008-roles.md)) : `admin` et `premium`, lus dans
  `app_metadata.roles`, rendus par `/v2/auth/me`, vérifiés par `@Roles` et `RolesGuard`. Aucune
  route n'est encore réservée. Restent à décider : les routes à réserver, et comment premium
  s'obtient (un paiement en ferait peut-être une offre avec échéance plutôt qu'un rôle).
- **Étapes et pas sans ordre** : ils sont indépendants, aucun n'en attend un autre. Une étape est
  faite ou non faite, rien d'autre. Seul Akari le dérive encore (au moins un pas, tous faits :
  instructions, `getObjectiveTree`) ; depuis le retrait de la v1, l'API rend la colonne en base.
- **`done` des objectifs en v2** : l'arbre BFF (`GET /v2/bff/objective-tree`) et les commandes
  rendent la colonne `objectives.done` telle quelle. Rien ne la tient à jour : elle vaut `false` à
  la création et y reste, même quand tous les pas sont faits. Décision assumée (ADR 0006) ; à
  reprendre si les clients v2 doivent afficher « objectif terminé ». Le client web l'attend : il
  ne relit plus l'arbre après un geste accepté (ADR 0001 d'apex), donc il faut aussi **rendre** le
  `done` des étapes et de l'objectif qui changent après une commande sur un pas (`completeTask`,
  `reopenTask`, `addTaskToObjective`, `moveTask`, `deleteTask`), pas seulement tenir la colonne.
- **Passage des clients en v2** : le web est passé aux commandes et à l'arbre BFF (7 novembre
  2026). La v1 a été retirée le 8 novembre 2026 ([ADR 0007](./adr/0007-retrait-de-la-v1.md)) :
  le mobile doit appeler `/v2` (commandes, arbre BFF, et le préfixe `/v2` pour l'authentification,
  la conversation et l'assistant).
- **Règles métier encore dans le client** : la catégorie d'Eisenhower vit encore dans le client
  mobile ; le web a retiré sa matrice en attendant que le serveur la calcule. Aucun cas d'usage de
  déplacement n'est prévu : un pas ne se déplace pas depuis la matrice, il suit son importance et
  son urgence, modifiées depuis l'objectif.
- **Vérifications non faites ici** : l'appel réel à Gemini (pas de clé dans l'environnement de
  travail) et Firestore réel (testé avec une doublure qui en reproduit les limites). Le SDK Gemini
  est vérifié face à un faux serveur HTTP : adresse, clé dans `x-goog-api-key`, lecture des
  réponses et des refus. En production, les premiers appels (29 octobre 2026) ont été refusés en
  `401` : Gemini n'accepte pas la clé `GEMINI_API_KEY` configurée sur Render. Une panne de Gemini
  est désormais journalisée avec son statut HTTP, le code et le message de Gemini (ou
  « empty response body ») et, pour un refus de la clé, la variable à vérifier. L'appel réel à
  Claude n'est pas vérifié non plus : son SDK l'est face à un faux serveur HTTP (`POST /v1/messages`,
  clé dans `Authorization`, version de l'API, lecture des réponses et des refus).
- **Historique des échanges avec Claude** (`ai-interaction-histories`, ADR 0009) : rien ne le
  supprime, pas même la suppression de l'objectif. Expiration (TTL Firestore) et effacement avec
  l'objectif à prévoir.
- **Interactions conservées par Gemini** : 1 jour sur le palier gratuit, 55 jours sur le palier
  payant. Une conversation reprise après ce délai envoie un `previous_interaction_id` expiré ;
  le comportement de Gemini dans ce cas (et la reprise à prévoir) reste à vérifier.
- **État de l'assistant** : retirer `value` et `lastError.step` quand plus aucune version installée
  ne les lira. Les clients à jour lisent `activity` (`docs/adr/0005-activite-de-l-assistant.md`).
- **Backlog d'Apex** encore ouvert : laisser filer (objectif, étape, pas), renommer les cas
  d'usage selon le métier (`DefineObjective`…), plusieurs instances du serveur (les
  acteurs XState vivent en mémoire d'un seul processus).

## 8. Questions ouvertes

- `WhatIsTodayFocusUsecase` garde les pas déjà faits dans les cinq pas du jour (comportement
  d'Apex conservé). S'ils doivent sortir du focus une fois cochés, c'est un filtre à ajouter.
- `ObjectiveRepository.save` réécrit tout l'arbre chargé : une écriture commencée avant une
  suppression peut faire réapparaître ce qui vient d'être supprimé (Akari ajoute un pas à l'objectif
  pendant qu'on supprime une de ses étapes). La fenêtre se compte en millisecondes ; la fermer
  demanderait que `save` n'écrive que ce qui a changé.
- Le client web n'utilise plus `WhatIsTodayFocusUsecase` depuis la V1 (pas d'écran Aujourd'hui) :
  l'endpoint est exposé pour le mobile, à retirer s'il n'en a pas l'usage.
