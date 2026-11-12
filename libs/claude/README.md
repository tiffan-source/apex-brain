# claude

Adaptateur Claude (SDK `@anthropic-ai/sdk`, API Messages) du port `InteractiveAIProvider`.

L'API Messages ne garde rien d'un appel à l'autre : l'adaptateur range l'historique de chaque interaction (port `InteractionHistoryRepository` de `@org/ai`, Firestore ou mémoire) sous l'id du message rendu par Claude, et renvoie toute la conversation à chaque appel, avec le cache de prompt. Voir l'[ADR 0008](../../docs/adr/0008-fournisseur-claude.md).

- Tests : `npx nx vite:test claude`
- Lint : `npx nx lint claude`
- Types : `npx nx typecheck claude`
