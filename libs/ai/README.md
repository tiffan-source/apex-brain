# ai

Capacité générique de génération par une IA (port `InteractiveAIProvider`). Ne connaît ni les objectifs ni les conversations.

Le port `InteractionHistoryRepository` range l'historique de chaque interaction pour un fournisseur dont l'API ne garde rien d'un appel à l'autre (Claude) ; `InMemoryInteractionHistoryRepository` le garde en mémoire (tests, développement local).

- Tests : `npx nx vite:test ai`
- Lint : `npx nx lint ai`
- Types : `npx nx typecheck ai`
