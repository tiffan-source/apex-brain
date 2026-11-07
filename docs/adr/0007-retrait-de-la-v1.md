# ADR 0007 — Retrait de la v1

- Statut : accepté
- Date : 2026-11-08
- Remplace en partie : [ADR 0006](./0006-commandes-et-bff.md) (paragraphe « Versions » et ses
  conséquences)

## Contexte

L'ADR 0006 gardait la v1 gelée et dépréciée tant que des clients l'appelaient : deux contrôleurs
(`ObjectivesController`, `TasksController`), quatre anciens cas d'usage (`usecases/legacy/` :
`EditObjectiveUsecase`, `EditMyTaskUsecase`, `UpdateDoneStatusOfTaskUsecase`,
`GetMyObjectivesUsecase`), un port (`GetAllObjectiveAndTaskQuery`) avec son adaptateur Supabase et sa
doublure, leurs schémas et leurs tests. Toutes les routes répondaient sous `/v1` et `/v2`.

Ce code dupliquait la v2 (le déplacement d'un pas était écrit deux fois) et chaque changement du
domaine devait le garder en vie.

## Décision

La v1 est retirée, pour toutes les routes : objectifs et pas, mais aussi authentification,
conversation et assistant.

- L'API ne sert plus que `/v2` (et `/health`, sans version) : `defaultVersion: '2'` dans
  `configure-app.ts`. Un appel sous `/v1/…` répond `404 NOT_FOUND`.
- Supprimés : `ObjectivesController`, `TasksController`, `libs/objective/src/lib/usecases/legacy/`,
  `GetAllObjectiveAndTaskQuery` (port, adaptateur Supabase, doublure en mémoire), les sorties
  `ObjectiveMapper.toObjectiveOutput` / `toTaskOutput`, les schémas et les tests e2e de la v1.
- Les tests e2e de la v1 qui couvraient un comportement encore servi (suppression d'une étape,
  double suppression, panne de la base, validation des corps, isolation) sont repris sur les routes
  v2. Les tests qui appelaient `/v1` pour l'authentification, la conversation et l'assistant appellent
  `/v2`.

## Conséquences

- Tout client (web, mobile) doit appeler `/v2`. Un client resté sur `/v1` reçoit des `404`.
- Plus aucune route ne calcule `done` d'un objectif ou d'une étape d'après ses pas : la v2 rend la
  colonne `objectives.done` telle quelle (ADR 0006). Seul Akari le dérive encore
  (`ObjectiveInternalService.getObjectiveTree`).
- `/v2` reste dans les URL : le versionnement par URI est gardé pour une future v3.
