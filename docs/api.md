# Contrat de l'API

Le document OpenAPI complet est servi par l'API : `/docs` (Swagger UI) et `/docs-json` (pour
générer un client typé). Ce document-ci en donne la vue d'ensemble et les règles communes.

## Règles communes

- **Versions** : toutes les routes sont sous `/v2`, sauf `/health`. Pour les objectifs et les pas,
  la v2 sépare les **commandes** (un geste nommé chacune) des **lectures BFF** (tag `bff`)
  ([ADR 0006](./adr/0006-commandes-et-bff.md)). La v1 a été retirée : `/v1/…` répond
  `404 NOT_FOUND` ([ADR 0007](./adr/0007-retrait-de-la-v1.md)).
- **Authentification** : `Authorization: Bearer <accessToken>` sur toute route sauf
  `/v2/auth/register`, `/v2/auth/login`, `/v2/auth/refresh` et `/health`.
- **Corps** : JSON. Les dates en entrée acceptent `2027-04-01` ou un instant ISO 8601 ; en sortie,
  ce sont des instants ISO 8601 (`2027-04-01T00:00:00.000Z`).
- **Réponses** : le corps d'une réponse réussie est la sortie du cas d'usage, telle quelle (mêmes
  noms de champs que dans Apex). Les commandes rendent toujours l'entité entière (`null` ou `""`
  pour ce qui est vide).
- **Propriété** : on ne voit et ne modifie que ce qui nous appartient. Un élément d'une autre
  personne répond `404`, comme un élément qui n'existe pas.
- **Limitation de débit** : par personne connectée (sinon par adresse IP), sur une minute
  (`THROTTLE_*_LIMIT`). Au-delà : `429 TOO_MANY_REQUESTS`.

## Erreurs

Toujours sous la forme :

```json
{ "error": { "code": "TASK_NOT_FOUND", "message": "Task with ID t1 not found" } }
```

Le **code** est le contrat : le client choisit sa phrase d'après lui. Le **message** est technique
(en anglais) et ne doit jamais être montré tel quel ; celui d'une panne inattendue est masqué.
`VALIDATION_ERROR` détaille les champs refusés dans `details: [{ path, message }]`.

| Statut | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST` (JSON illisible), `WEAK_PASSWORD`, `INVALID_EMAIL` |
| 401 | `UNAUTHENTICATED` (jeton absent ou invalide), `INVALID_CREDENTIALS`, `INVALID_SESSION` |
| 403 | `EMAIL_NOT_CONFIRMED` |
| 404 | `OBJECTIVE_NOT_FOUND`, `TASK_NOT_FOUND`, `CONVERSATION_NOT_FOUND`, `NOT_FOUND` (route) |
| 409 | `USER_ALREADY_EXIST`, `WORKFLOW_BUSY`, `NO_PENDING_PERMISSION` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `FAIL_TO_SAVE_OBJECTIVE`, `FAIL_TO_SAVE_TASK`, `UNKNOWN_ERROR` |

## Authentification

| Méthode et route | Cas d'usage | Corps | Réponse |
|---|---|---|---|
| `POST /v2/auth/register` | `CreateNewUserUseCase` | `{ email, password }` | `201 { user, session \| null }` |
| `POST /v2/auth/login` | `LogUserInUseCase` | `{ email, password }` | `200 { user, session }` |
| `POST /v2/auth/refresh` | `RefreshSessionUseCase` | `{ refreshToken }` | `200 { user, session }` |
| `POST /v2/auth/logout` | `LogUserOutUseCase` | — | `204` |
| `GET /v2/auth/me` | `GetCurrentUserUseCase` | — | `200 { id, name, email }` |

`user` vaut `{ id, name, email }` (`name` : le nom d'affichage, à défaut l'e-mail) ; `session`
vaut `{ accessToken, refreshToken, expiresAt }`. `session` est `null` à l'inscription tant que
l'e-mail doit être confirmé. Le client renouvelle la session avant `expiresAt` ou sur un `401`.

## Objectifs, étapes et pas (v2)

### Commandes

Chaque commande porte une intention, et son `operationId` OpenAPI est son nom. Elle rend l'entité
créée ou modifiée, entière mais sans ses enfants, pour que le client la remplace dans son arbre en
cache sans tout relire :

- `ObjectiveEntity` : `{ id, title, description, why, dueDate | null, parentObjectiveId | null, done }` ;
- `TaskEntity` : `{ id, title, importance, urgency, done, objectiveId }`.

| Méthode et route | `operationId` (cas d'usage) | Corps | Réponse |
|---|---|---|---|
| `POST /v2/objectives` | `createObjective` | `{ title, description?, why?, dueDate? }` | `201 ObjectiveEntity` |
| `POST /v2/objectives/{objectiveId}/sub-objectives` | `addSubObjective` | `{ title }` | `201 ObjectiveEntity` |
| `POST /v2/objectives/{objectiveId}/tasks` | `addTaskToObjective` | `{ title, importance, urgency }` | `201 TaskEntity` |
| `PATCH /v2/objectives/{objectiveId}/rename` | `renameObjective` | `{ title }` | `200 ObjectiveEntity` |
| `PATCH /v2/objectives/{objectiveId}/clarify` | `clarifyObjective` | `{ description?, why? }` (au moins un) | `200 ObjectiveEntity` |
| `PATCH /v2/objectives/{objectiveId}/set-deadline` | `setObjectiveDeadline` | `{ dueDate }` | `200 ObjectiveEntity` |
| `PATCH /v2/objectives/{objectiveId}/remove-deadline` | `removeObjectiveDeadline` | — | `200 ObjectiveEntity` |
| `DELETE /v2/objectives/{objectiveId}` | `deleteObjective` | — | `204` |
| `PATCH /v2/tasks/{taskId}/rename` | `renameTask` | `{ title }` | `200 TaskEntity` |
| `PATCH /v2/tasks/{taskId}/reprioritize` | `reprioritizeTask` | `{ importance, urgency }` | `200 TaskEntity` |
| `PATCH /v2/tasks/{taskId}/move` | `moveTask` | `{ objectiveId }` | `200 TaskEntity` |
| `PATCH /v2/tasks/{taskId}/complete` | `completeTask` | — | `200 TaskEntity` |
| `PATCH /v2/tasks/{taskId}/reopen` | `reopenTask` | — | `200 TaskEntity` |
| `DELETE /v2/tasks/{taskId}` | `deleteTask` | — | `204` |
| `GET /v2/tasks/today-focus` | `whatIsTodayFocus` | — | `200 [{ id, title, objectiveId, important, urgent, dueDate?, done }]` |

- Les commandes sur un objectif valent aussi pour une étape.
- `clarifyObjective` : un champ absent reste inchangé, `""` le vide ; `{}` répond
  `400 VALIDATION_ERROR`.
- Une commande sans effet réussit (`200` avec l'entité) : `completeTask` sur un pas fait,
  `reopenTask` sur un pas à faire, `removeObjectiveDeadline` sans échéance, `moveTask` vers
  l'objectif qui porte déjà le pas. Un client peut la rejouer après une coupure.
- `moveTask` déplace le pas vers une autre étape, un objectif, un ancêtre ; un objectif d'une autre
  personne répond `404 OBJECTIVE_NOT_FOUND`.
- `deleteObjective` vaut pour un objectif comme pour une étape, et emporte tout ce qui en dépend :
  ses étapes, leurs pas et, pour un objectif principal, sa conversation, ses messages et son
  assistant (arrêté même en plein tour). Supprimer une étape ne touche ni à son objectif, ni à sa
  conversation. La suppression est définitive : il n'y a pas de corbeille.
- Supprimer un élément déjà supprimé (double appui, nouvel essai après une coupure) répond `404` :
  le client peut le traiter comme un succès.
- `importance` et `urgency` vont de 1 à 5 (à partir de 3 : important, urgent).
- `whatIsTodayFocus` reste un cas d'usage : il porte la règle de priorité du jour.
- `done` d'une `ObjectiveEntity` est celui de la base (voir plus bas).

### Lectures BFF

Des lectures taillées pour les clients d'Apex (web et mobile), sans logique métier : un port que
l'infrastructure implémente directement.

| Méthode et route | `operationId` | Réponse |
|---|---|---|
| `GET /v2/bff/objective-tree` | `getObjectiveTree` | `200 { objectives: ObjectiveTreeNode[] }` |

- `ObjectiveTreeNode` : `{ id, title, description, why, dueDate | null, done, tasks: [{ id, title,
  importance, urgency, done }], subObjectives: ObjectiveTreeNode[] }`. Seuls les objectifs principaux
  sont à la racine ; les étapes sont emboîtées à toute profondeur.
- **`done` d'un objectif ou d'une étape est lu tel qu'il est en base, sans calcul.** Rien ne tient
  la colonne à jour pour l'instant : elle vaut `false` à la création et y reste, même quand tous les
  pas sont faits. C'est assumé ([ADR 0006](./adr/0006-commandes-et-bff.md)). Le `done` des pas est juste.
- Les étapes d'un objectif n'ont aucun ordre, les pas d'une étape non plus : ils sont indépendants,
  aucun n'en attend un autre. Les listes sont triées par création, puis par id, pour que l'affichage
  ne saute pas d'une lecture à l'autre : ce tri ne porte aucun sens.

## Conversation et assistant

| Méthode et route | Capacité | Corps | Réponse |
|---|---|---|---|
| `GET /v2/objectives/{objectiveId}/conversation` | `GetConversationsQuery` | — | `200 { id, messages: [{ id, sender, content, createdAt }] }` |
| `GET /v2/objectives/{objectiveId}/assistant` | `startWorkFlow` + `getState` | — | `200 WorkflowState` |
| `POST /v2/objectives/{objectiveId}/assistant/messages` | `sendMessage` | `{ message }` | `202 WorkflowState` |
| `POST /v2/objectives/{objectiveId}/assistant/permission` | `respondToPermission` | `{ granted, toolCallId? }` | `202 WorkflowState` |

Seul un objectif principal a une conversation (une étape, ou un objectif supprimé, répond
`404 CONVERSATION_NOT_FOUND`).
`sender` vaut l'id de la personne, ou `AI` pour Akari.

```text
WorkflowState = {
  objectiveId,
  value,              // déprécié : la valeur de la machine XState (lire `activity`)
  status,             // ready | processing | awaiting-permission
  activity,           // ce que fait Akari, null au repos (voir plus bas)
  pendingToolCall,    // { id, name, arguments } quand status = awaiting-permission, sinon null
  lastRegisteredMessage, // { id, content, sender, createdAt } | null
  lastError           // { code, step, at } | null : la panne du dernier tour
}

activity = {
  step,               // ce qu'Akari fait maintenant
  elapsedMs,          // le temps déjà passé sur cette étape, mesuré par le serveur
  round,              // ses passages par l'IA depuis le début du tour (2 et plus : un tour de boucle)
  done                // ce qu'il a déjà fait pendant ce tour, du plus ancien au plus récent
}
```

`step` et `done` utilisent les codes ci-dessous. Ils sont le contrat : les clients choisissent leur
phrase d'après eux et ignorent un code qu'ils ne connaissent pas. Ils ne disent ni quel outil tourne,
ni quel fournisseur d'IA répond, ni dans quel état est la machine.

| Code | Akari… |
|---|---|
| `saving-message` | enregistre le message de la personne |
| `thinking` | réfléchit à la demande (premier passage par l'IA) |
| `checking-permission` | vérifie si ce qu'il veut faire demande l'accord de la personne |
| `awaiting-permission` | attend cet accord (`status: awaiting-permission`) |
| `reading` | lit les données de la personne |
| `writing` | écrit ce que la personne a accepté |
| `reviewing` | fait le point sur ce qu'il vient de faire (nouveau passage par l'IA) |
| `saving-reply` | enregistre sa réponse |

`done` garde les étapes trop brèves pour qu'une interrogation chaque seconde les voie passer : la
vérification d'un accord dure quelques millisecondes, un appel à l'IA plusieurs secondes. Une étape y
figure parce qu'elle a eu lieu, pas parce qu'elle a réussi : une écriture refusée par un outil reste
`writing`, et c'est Akari qui le dit dans sa réponse. Un tour commencé avant l'arrivée de `activity`
peut être `processing` avec `activity: null`.

Un tour se déroule ainsi :

1. `POST …/assistant/messages` → `202`, `status: processing`. Un message pendant un tour en cours
   répond `409 WORKFLOW_BUSY`.
2. Le client interroge `GET …/assistant` (Apex : chaque seconde) jusqu'à `ready` ou
   `awaiting-permission`. `activity` dit ce que fait Akari, `lastRegisteredMessage` donne le message
   enregistré à afficher.
3. Si Akari veut ajouter une étape (`createSubObjective`) ou un pas (`createTask`) :
   `status: awaiting-permission`, `pendingToolCall` décrit la proposition. Le client répond par
   `POST …/assistant/permission` avec `granted` et le `toolCallId` reçu, puis reprend
   l'interrogation. Après un ajout accepté, recharger `GET /v2/bff/objective-tree`.
4. Une panne (IA indisponible…) ramène à `ready` avec `lastError` : le message de la personne est
   enregistré, elle peut réessayer. `lastError` disparaît au message suivant.

## Passer le client web d'Apex à l'API

Les stores d'Apex appellent des ports (`CreateObjectiveUsecase`, `GetConversationsQuery`,
`SendMessageToAIWorkflow`…). Pour migrer sans toucher aux stores, on remplace dans
`apps/apex-client/src/chore/providers/*.ts` chaque implémentation par un adaptateur HTTP qui rend
la même chose : un `Result<T>` construit depuis la réponse (`{ success: true, data }`, ou
`{ success: false, error }` depuis le corps d'erreur), les dates ISO converties en `Date`.
L'`ownerId` que les stores passent encore n'est plus nécessaire : le serveur le tire du jeton.
