# firebase

Adaptateurs Firestore (`firebase-admin`) : l'état des workflows de l'assistant (`IWorkflowStateRepository`,
collection `workflow-states`) et les compteurs des politiques d'usage (`UsageLedger`, collection
`usage-counters`, voir `docs/adr/0010-politiques-d-usage.md`).

- Tests : `npx nx vite:test firebase`
- Lint : `npx nx lint firebase`
- Types : `npx nx typecheck firebase`
