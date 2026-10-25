# Contrat de l'API

Le document OpenAPI complet est servi par l'API : `/docs` (Swagger UI) et `/docs-json` (pour
générer un client typé). Ce document-ci en donne la vue d'ensemble et les règles communes.

## Règles communes

- **Versions** : toutes les routes sont sous `/v1`, sauf `/health`.
- **Authentification** : `Authorization: Bearer <accessToken>` sur toute route sauf
  `/v1/auth/register`, `/v1/auth/login`, `/v1/auth/refresh` et `/health`.
- **Corps** : JSON. Les dates en entrée acceptent `2027-04-01` ou un instant ISO 8601 ; en sortie,
  ce sont des instants ISO 8601 (`2027-04-01T00:00:00.000Z`).
- **Réponses** : le corps d'une réponse réussie est la sortie du cas d'usage, telle quelle (mêmes
  noms de champs que dans Apex). Un champ facultatif absent n'est pas renvoyé.
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
| `POST /v1/auth/register` | `CreateNewUserUseCase` | `{ email, password }` | `201 { user, session \| null }` |
| `POST /v1/auth/login` | `LogUserInUseCase` | `{ email, password }` | `200 { user, session }` |
| `POST /v1/auth/refresh` | `RefreshSessionUseCase` | `{ refreshToken }` | `200 { user, session }` |
| `POST /v1/auth/logout` | `LogUserOutUseCase` | — | `204` |
| `GET /v1/auth/me` | `GetCurrentUserUseCase` | — | `200 { id, name, email }` |

`user` vaut `{ id, name, email }` (`name` : le nom d'affichage, à défaut l'e-mail) ; `session`
vaut `{ accessToken, refreshToken, expiresAt }`. `session` est `null` à l'inscription tant que
l'e-mail doit être confirmé. Le client renouvelle la session avant `expiresAt` ou sur un `401`.

## Objectifs, étapes et pas

| Méthode et route | Cas d'usage | Corps | Réponse |
|---|---|---|---|
| `GET /v1/objectives` | `GetAllObjectiveAndTaskQuery` | — | `200 { objectives: ObjectiveOutput[], tasks: TaskOutput[] }` |
| `POST /v1/objectives` | `CreateObjectiveUsecase` | `{ title, description?, why?, dueDate? }` | `201 { id, title, description?, why?, dueDate? }` |
| `PATCH /v1/objectives/{objectiveId}` | `EditObjectiveUsecase` | `{ title, description?, why?, dueDate? }` | `200` (même forme) |
| `POST /v1/objectives/{objectiveId}/sub-objectives` | `AddSubObjectiveUsecase` | `{ title }` | `201 { id, title }` |
| `POST /v1/objectives/{objectiveId}/tasks` | `AddTaskToObjectiveUsecase` | `{ title, importance, urgency }` | `201 { id, title, importance, urgency }` |
| `PATCH /v1/tasks/{taskId}` | `EditMyTaskUsecase` | `{ title, objectiveId, importance, urgency }` | `200 { id, title, objectiveId, importance, urgency }` |
| `PUT /v1/tasks/{taskId}/done` | `UpdateDoneStatusOfTaskUsecase` | `{ done }` | `200 { id, title, done }` |
| `GET /v1/tasks/today-focus` | `WhatIsTodayFocusUsecase` | — | `200 [{ id, title, objectiveId, important, urgent, dueDate?, done }]` |

- `ObjectiveOutput` : `{ id, title, description, why, dueDate | null, parentObjective | null }` ;
  `TaskOutput` : `{ id, title, importance, urgency, done, objectiveId }`. L'ordre est stable :
  création, puis id.
- `PATCH /v1/objectives/{id}` : un champ absent reste inchangé ; `dueDate: null` retire l'échéance.
  Vaut pour un objectif comme pour une étape.
- `PATCH /v1/tasks/{id}` : changer `objectiveId` déplace le pas (vers une étape, un objectif,
  un ancêtre).
- `importance` et `urgency` vont de 1 à 5 (à partir de 3 : important, urgent).

## Conversation et assistant

| Méthode et route | Capacité | Corps | Réponse |
|---|---|---|---|
| `GET /v1/objectives/{objectiveId}/conversation` | `GetConversationsQuery` | — | `200 { id, messages: [{ id, sender, content, createdAt }] }` |
| `GET /v1/objectives/{objectiveId}/assistant` | `startWorkFlow` + `getState` | — | `200 WorkflowState` |
| `POST /v1/objectives/{objectiveId}/assistant/messages` | `sendMessage` | `{ message }` | `202 WorkflowState` |
| `POST /v1/objectives/{objectiveId}/assistant/permission` | `respondToPermission` | `{ granted, toolCallId? }` | `202 WorkflowState` |

Seul un objectif principal a une conversation (une étape répond `404 CONVERSATION_NOT_FOUND`).
`sender` vaut l'id de la personne, ou `AI` pour Akari.

```text
WorkflowState = {
  objectiveId,
  value,              // valeur de la machine XState, comme dans Apex
  status,             // ready | processing | awaiting-permission
  pendingToolCall,    // { id, name, arguments } quand status = awaiting-permission, sinon null
  lastRegisteredMessage, // { id, content, sender, createdAt } | null
  lastError           // { code, step, at } | null : la panne du dernier tour
}
```

Un tour se déroule ainsi :

1. `POST …/assistant/messages` → `202`, `status: processing`. Un message pendant un tour en cours
   répond `409 WORKFLOW_BUSY`.
2. Le client interroge `GET …/assistant` (Apex : chaque seconde) jusqu'à `ready` ou
   `awaiting-permission`. `lastRegisteredMessage` donne le message enregistré à afficher.
3. Si Akari veut ajouter une étape (`createSubObjective`) ou un pas (`createTask`) :
   `status: awaiting-permission`, `pendingToolCall` décrit la proposition. Le client répond par
   `POST …/assistant/permission` avec `granted` et le `toolCallId` reçu, puis reprend
   l'interrogation. Après un ajout accepté, recharger `GET /v1/objectives`.
4. Une panne (IA indisponible…) ramène à `ready` avec `lastError` : le message de la personne est
   enregistré, elle peut réessayer. `lastError` disparaît au message suivant.

## Passer le client web d'Apex à l'API

Les stores d'Apex appellent des ports (`CreateObjectiveUsecase`, `GetConversationsQuery`,
`SendMessageToAIWorkflow`…). Pour migrer sans toucher aux stores, on remplace dans
`apps/apex-client/src/chore/providers/*.ts` chaque implémentation par un adaptateur HTTP qui rend
la même chose : un `Result<T>` construit depuis la réponse (`{ success: true, data }`, ou
`{ success: false, error }` depuis le corps d'erreur), les dates ISO converties en `Date`.
L'`ownerId` que les stores passent encore n'est plus nécessaire : le serveur le tire du jeton.
