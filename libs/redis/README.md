# redis

Adaptateur Redis du bus d'événements (`@org/event-bus`), par le pub/sub de Redis (`ioredis`), pour
une API qui tourne sur plusieurs instances
([ADR 0010](../../docs/adr/0010-runtime-des-workflows-et-bus-d-evenements.md)).

- `RedisEventBus.connect({ url, channel })` : deux connexions (publication, abonnement au canal) ;
  rejette au démarrage si Redis ne répond pas, se reconnecte seul ensuite.
- Un abonné `one-instance` (une réaction du serveur) reçoit l'événement sur l'instance qui le publie,
  sans passer par Redis ; un abonné `every-instance` (un flux SSE) le reçoit de Redis, sur chaque
  instance.
- Au plus une fois : ce qui est publié pendant une coupure est perdu pour les autres instances, et
  une publication n'est jamais renvoyée.

- Tests : `npx nx vite:test redis` ; contre un vrai Redis :
  `REDIS_INTEGRATION=1 REDIS_URL=redis://127.0.0.1:6379 npx nx vite:test redis`
- Lint : `npx nx lint redis`
- Types : `npx nx typecheck redis`
