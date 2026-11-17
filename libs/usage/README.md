# usage

Les politiques d'usage d'Apex : qui peut faire quelle action, et combien de fois
([ADR 0010](../../docs/adr/0010-politiques-d-usage.md)). Un mécanisme du système, comme l'authentification :
le métier et les workflows n'en savent rien (tag `type:policy`), et la lib ne sait pas où vivent les politiques
ni les compteurs.

- `allowanceFor` : le droit d'une personne sur une action, d'après ses rôles et les politiques.
- `UsageGate` : réserver une unité avant une action (et la rendre si elle échoue), décrire ce qu'il reste.
- `HeldReservations` : les unités d'une action dont l'issue n'est connue qu'après coup.
- Ports : `UsagePolicySource` (les politiques en vigueur) et `UsageLedger` (les compteurs), implémentés par
  l'infrastructure ; `InMemoryUsageLedger` pour le développement, `@org/usage/testing` pour les tests.

- Tests : `npx nx vite:test usage`
- Lint : `npx nx lint usage`
- Types : `npx nx typecheck usage`
