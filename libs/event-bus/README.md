# event-bus

Le bus d'événements ([ADR 0010](../../docs/adr/0010-runtime-des-workflows-et-bus-d-evenements.md)) : les
workflows y publient leurs faits, l'application s'y abonne pour réagir, sans que l'un connaisse les
autres ni le bus qui les transporte (tag `type:runtime`).

- `EventBus` : le port (`publish`, `subscribe`, `close`) ; `BusEvent` : l'enveloppe d'un fait ;
  `parseBusEvent` : relire un fait transporté en JSON par un bus distant.
- `delivery`, à l'abonnement : `one-instance` (par défaut), sur l'instance qui publie (les réactions
  du serveur) ; `every-instance`, sur chaque instance (ce qui suit une connexion, comme un flux SSE).
- `InMemoryEventBus` : une seule instance de l'API, les tests et le développement. Le bus Redis, pour
  plusieurs instances, est dans `libs/redis`.
- `LocalEventDispatcher` : la livraison aux abonnés d'un processus, commune à tous les bus (une file
  par abonné, hors de la pile de celui qui publie, erreurs journalisées sans remonter).
- `@org/event-bus/testing` : `InMemoryEventBusCluster`, plusieurs instances d'un même processus
  reliées comme par Redis (tests).

Au plus une fois : un événement peut se perdre, jamais être livré deux fois par le bus. `close`, en
dernier à l'arrêt : les abonnés finissent ce qu'ils ont reçu, puis plus rien n'est publié ni livré.

- Tests : `npx nx vite:test event-bus`
- Lint : `npx nx lint event-bus`
- Types : `npx nx typecheck event-bus`
