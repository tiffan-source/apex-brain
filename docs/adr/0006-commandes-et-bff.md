# ADR 0006 — Des commandes nommées d'un côté, des lectures BFF de l'autre

- Statut : accepté ; paragraphe « Versions » remplacé par l'[ADR 0007](./0007-retrait-de-la-v1.md)
  (la v1 est retirée)
- Date : 2026-11-07

## Contexte

La v1 de l'API calquait le REST générique : `PATCH /v1/objectives/{id}` changeait à la fois le titre,
la description, le pourquoi et l'échéance ; `PATCH /v1/tasks/{id}` renommait, changeait l'importance
et l'urgence **et** déplaçait le pas ; `PUT /v1/tasks/{id}/done` cochait et décochait. Le nom d'un cas
d'usage (`EditObjective`, `EditMyTask`, `UpdateDoneStatusOfTask`) ne disait pas ce que la personne
faisait.

`GET /v1/objectives` était aussi un cas d'usage (`GetMyObjectivesUsecase`) : une lecture taillée pour
l'écran, qui calculait `done` et rendait une liste à plat que chaque client remettait en arbre.

## Décision

Deux sortes d'opérations, séparées.

**Les commandes** sont les cas d'usage : elles agissent sur les données et ont un nom métier.

- Une commande = une intention : `RenameObjective`, `ClarifyObjective` (description et pourquoi),
  `SetObjectiveDeadline`, `RemoveObjectiveDeadline`, `RenameTask`, `ReprioritizeTask` (importance et
  urgence), `MoveTask`, `CompleteTask`, `ReopenTask`, à côté de `CreateObjective`,
  `AddSubObjective`, `AddTaskToObjective`, `DeleteObjective`, `DeleteTask`.
- Le nom va du cas d'usage (`RenameObjectiveUsecase`) à l'`operationId` OpenAPI (`renameObjective`)
  et à la route (`PATCH /v2/objectives/{id}/rename`). Verbe HTTP : `PATCH` pour une modification
  pure, `POST` pour une création (ou un mélange), `DELETE` pour une suppression.
- Une commande rend l'**entité** créée ou modifiée, entière mais sans ses enfants (objectif :
  `{ id, title, description, why, dueDate, parentObjectiveId, done }` ; pas :
  `{ id, title, importance, urgency, done, objectiveId }`). Le client la remplace dans son arbre en
  cache (optimistic update) sans relire tout l'arbre.
- Une commande sans effet réussit : `CompleteTask` sur un pas fait, `RemoveObjectiveDeadline` sans
  échéance, `MoveTask` vers l'objectif qui porte déjà le pas. Un client peut rejouer après une coupure.
- `WhatIsTodayFocus` reste un cas d'usage : il porte une règle métier (la priorité du jour) qui va
  s'enrichir.

**Les lectures BFF** existent pour les clients d'Apex (web et mobile), pas pour le domaine.

- Elles ne sont qu'un port (une interface), que l'infrastructure implémente directement : pas de cas
  d'usage, pas de logique métier. Pour l'instant, une seule : `GetObjectiveTreeQuery`
  (`GET /v2/bff/objective-tree`, tag `bff`), l'arbre emboîté de tous les objectifs.
- Le port vit **dans le domaine qu'il lit**, dans un dossier `bff/` (`libs/objective/src/lib/bff/`),
  exporté par un point d'entrée à part, `@org/objective/bff`. Une lib `bff` séparée a été écartée : la
  lecture et les commandes d'un même domaine peuvent partager du code, et le BFF reste à côté de ce
  qu'il lit.
- Ni une commande, ni Akari ne lisent une lecture BFF (règle `no-restricted-imports` dans
  `eslint.config.mjs`) : seules l'infrastructure qui l'implémente et l'app qui l'expose importent
  `@org/<lib>/bff` (`allowBffImports`). Akari déclare ses propres besoins et passe par le domaine
  (`ObjectiveInternalService`).
- `done` d'un objectif ou d'une étape est lu **tel qu'il est en base** (`objectives.done`), sans calcul.
  Rien ne tient cette colonne à jour pour l'instant : elle vaut `false` à la création et y reste.
  C'est assumé ; le `done` des pas, lui, est juste.

**Versions** : la v2 porte ce découpage. La v1 reste servie telle quelle, gelée et marquée dépréciée,
parce que les clients la consomment : ses anciens cas d'usage vivent dans `usecases/legacy/` et
partiront avec elle. Les routes qui n'ont pas changé (authentification, conversation, assistant)
sont servies par les deux versions, pour que les clients changent leur préfixe en une fois.

## Conséquences

- Un nouveau geste de la personne, c'est une nouvelle commande nommée, pas un champ de plus dans un
  `PATCH` générique.
- En v2, un client n'affiche plus « objectif terminé » d'après `done` tant que rien ne tient la colonne
  à jour. La v1 et Akari calculent toujours `done` d'après les pas.
- Deux ensembles de routes pour les objectifs et les pas, tant que la v1 vit. Quand plus aucun client
  ne l'appelle : supprimer `ObjectivesController`, `TasksController`, `usecases/legacy/` et
  `GetAllObjectiveAndTaskQuery`.
