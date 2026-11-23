# workflow-runtime

Le runtime des workflows ([ADR 0010](../../docs/adr/0010-runtime-des-workflows-et-bus-d-evenements.md)) :
il héberge les acteurs XState d'un workflow, une instance par clé, et garde leur état. Il ne sait
rien d'un workflow en particulier, ni du métier, ni de l'infrastructure (tag `type:runtime`).

- `WorkflowRuntime` : `obtain` (en mémoire, restaurée ou créée), `forget`, `evictIdle`, `shutdown`.
  Restaurer un snapshot relance l'étape qui était en cours ; chaque transition est sauvegardée, dans
  l'ordre.
- `WorkflowDefinition` : ce qu'un workflow lui confie (nom, machine munie de ses ports, `ownerOf`,
  `recover`, `isResting`).
- Port `WorkflowStateStore`, version en mémoire `InMemoryWorkflowStateStore` (tests, développement) ;
  Firestore dans `@org/firebase`.

- Tests : `npx nx vite:test workflow-runtime`
- Lint : `npx nx lint workflow-runtime`
- Types : `npx nx typecheck workflow-runtime`
