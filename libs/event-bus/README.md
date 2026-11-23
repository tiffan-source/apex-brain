# event-bus

Le bus d'événements ([ADR 0010](../../docs/adr/0010-runtime-des-workflows-et-bus-d-evenements.md)) : les
workflows y publient leurs faits, l'application s'y abonne pour réagir, sans que l'un connaisse les
autres ni le bus qui les transporte (tag `type:runtime`).

- `EventBus` : le port (`publish`, `subscribe`, `close`) ; `BusEvent` : l'enveloppe d'un fait.
- `InMemoryEventBus` : une seule instance de l'API, les tests et le développement.
- `LocalEventDispatcher` : la livraison aux abonnés d'un processus, commune à tous les bus (une file
  par abonné, hors de la pile de celui qui publie, erreurs journalisées sans remonter).

Au plus une fois : un événement peut se perdre, jamais être livré deux fois par le bus.

- Tests : `npx nx vite:test event-bus`
- Lint : `npx nx lint event-bus`
- Types : `npx nx typecheck event-bus`
