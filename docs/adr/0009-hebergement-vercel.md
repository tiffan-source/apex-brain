# ADR 0009 — Héberger l'API sur Vercel : une fonction, plusieurs instances

- Statut : proposé
- Date : 2026-11-16

## Contexte

Apex Brain tournait sur Render : un service web Node (plan gratuit, Francfort) qui construisait
l'API (`npx nx build api`) puis lançait `node dist/apps/api/main.js`. Le plan gratuit s'endort
après un quart d'heure sans requête, et la première requête qui le réveille attend. On passe à
Vercel.

Sur Vercel, l'API devient une **fonction** (Fluid compute) : aucun port ouvert, aucun processus
permanent. Vercel lance autant d'instances que le trafic le demande, en garde une en vie tant
qu'elle sert, peut la figer dès la réponse envoyée et la faire disparaître entre deux requêtes.

Deux hypothèses de l'[ADR 0004](./0004-orchestrateur.md) tombent avec le processus permanent :

1. **Un seul processus sert les workflows d'un objectif** : les acteurs XState vivent en mémoire,
   la mémoire fait foi. Avec plusieurs instances, l'interrogation chaque seconde d'un tour peut
   arriver sur une autre instance que celle qui le mène : elle restaurerait le tour depuis
   Firestore et **relancerait son étape** (un deuxième appel à l'IA, un outil exécuté deux fois),
   ou montrerait un état périmé (une demande d'accord à laquelle la personne a déjà répondu
   ailleurs).
2. **Le tour continue après la réponse `202`** dans un processus qui reste vivant. Une fonction
   peut être figée dès la réponse envoyée, le tour en plein vol.

Enfin, la détection NestJS de Vercel compile elle-même le point d'entrée (sans les alias de chemin
`@org/*`, sans regrouper le code) : elle ne sait pas construire ce monorepo Nx, dont le bundle Vite
émet aussi les métadonnées de décorateurs ([ADR 0001](./0001-workspace-et-outillage.md)).

## Décision

### 1. La sortie Vercel est construite par le dépôt

`npx nx run api:vercel-build` (la commande de build de `vercel.json`) :

- `nx build api` produit deux points d'entrée sur le même code (`create-app.ts`) : `main.js`
  écoute un port (serveur Node, développement), `serverless.js` reçoit `req`/`res` de Vercel ;
- `tools/vercel/build-output.mjs` écrit `.vercel/output` (Build Output API v3) : **une seule
  fonction** `api.func` (Node 24, région `fra1`, 300 s), avec le bundle et les seuls fichiers de
  `node_modules` qu'il charge (traçage `@vercel/nft`, l'outil de Vercel), plus Swagger UI ; toutes
  les routes vont à la fonction ; **aucun fichier statique**, rien du dépôt n'est exposé ;
- `tools/vercel/smoke-test.mjs` charge la fonction copiée hors du dépôt, comme Vercel, et vérifie
  quelques routes. La CI le lance.

### 2. Le tour garde l'instance en vie

`SendMessageToAIWorkflow` prévient l'hébergeur (`keepAlive`) de chaque tour qu'il lance ou
reprend, avec la promesse de son terme : au repos ou en attente d'un accord, sauvegardes faites.
L'app la confie au port `BackgroundWork` (`apps/api/src/platform/`), que `waitUntil` de Vercel
implémente : l'invocation dure jusqu'au terme du tour, dans la limite de 300 s. Hors de Vercel,
`waitUntil` ne fait rien.

### 3. Plusieurs instances : Firestore fait foi

Avec `ASSISTANT_TURN_OWNERSHIP_SECONDS` (posée à 330 s par le `.vc-config.json` de la fonction :
la durée maximale d'une invocation, plus une marge) :

- **Un tour en cours appartient à l'instance qui le mène** tant que sa dernière sauvegarde a moins
  de 330 s. Les autres instances le décrivent d'après l'état persisté (chaque transition l'est),
  sans le relancer, et refusent un autre message (`409 WORKFLOW_BUSY`).
- **Au-delà, il est abandonné** : l'instance qui le menait a forcément disparu, une invocation ne
  dépasse pas 300 s. La première instance qui le lit le reprend, comme après un redémarrage
  (l'étape interrompue est relancée, les messages ne sont pas doublés).
- **Une instance ne se fie à sa mémoire que pour le tour qu'elle mène.** Un acteur au repos est
  relu depuis Firestore avant d'agir : un accord ou un message a pu passer par une autre instance.
  Une lecture d'un workflow au repos ne crée pas d'acteur.

Sans la variable (0, la valeur par défaut), un seul processus sert tout : comportement de
l'ADR 0004 (serveur Node, développement). `serverless.ts` refuse de démarrer sans elle, et la
configuration refuse `WORKFLOW_STATE_STORE=memory` avec elle (les instances ne partageraient rien).

## Options écartées

- **Laisser Vercel détecter NestJS**, ou un dossier `api/` avec des réécritures dans `vercel.json` :
  la compilation de Vercel ne résout pas les alias `@org/*` ; l'ordre entre la commande de build
  et la construction de `api/` est implicite ; le dépôt serait servi en fichiers statiques.
- **Router chaque objectif vers une instance** (`x-vercel-affinity-id`, l'affinité de Vercel) :
  expérimentale, elle demande un en-tête aux clients et ne garantit rien quand l'instance
  disparaît. L'ADR 0004 la citait (« un routage par objectif »).
- **Un verrou transactionnel dans Firestore** (écriture conditionnelle de l'état) : ferme aussi les
  envois simultanés (voir les limites), au prix d'un port qui change et de transactions à chaque
  transition. À reprendre si ces limites gênent.
- **Garder un processus permanent** (Render payant, Railway, Fly…) : l'ADR 0004 tel quel, mais on
  veut quitter Render. Les Daemons de Vercel tournent en continu mais ne reçoivent pas de trafic
  HTTP.

## Conséquences

- **Projet Vercel** : le dépôt importé, préréglage « Other », racine du dépôt ; `vercel.json`
  donne les commandes. Les variables sont celles de Render (`apps/api/.env.example`), avec
  `TRUST_PROXY=true` (Vercel est un proxy). La région (`fra1`) et la durée (300 s) se changent
  dans `tools/vercel/build-output.mjs`.
- **Limites connues** :
  - deux messages envoyés au même instant au même objectif, reçus par deux instances, lancent
    deux tours (l'écriture conditionnelle ci-dessus les fermerait) ;
  - la limitation de débit compte en mémoire, par instance : la limite réelle peut être plus haute
    quand plusieurs instances tournent ;
  - un tour dont l'instance disparaît reste « en cours » jusqu'à 330 s avant d'être repris ;
  - supprimer un objectif pendant qu'une autre instance mène son tour : ce tour peut réécrire son
    état dans Firestore, où il ne sera plus jamais lu.
- **Plan Hobby** : gratuit, réservé à un usage personnel et non commercial (300 s, 2 Go, une
  région). Un lancement commercial d'Apex demande le plan Pro.
- **Render** reste en service le temps que le web et le mobile appellent Vercel, puis il est
  suspendu. Son build (`main.js`) fonctionne toujours.
- **Suite** : faire du `POST …/assistant/messages` un flux (SSE) qui suit le tour jusqu'à son
  terme supprimerait l'interrogation, `waitUntil` et la lecture croisée entre instances : le tour
  vivrait dans la requête qui le lance.
