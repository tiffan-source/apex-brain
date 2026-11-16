# usage

Les politiques d'usage d'Apex : qui peut faire quelle action, et combien de fois
([ADR 0010](../../docs/adr/0010-politiques-d-usage.md)). Des règles de produit (trois messages à Akari pour
un compte standard, le choix du modèle réservé à premium…), écrites dans des données et appliquées à
l'entrée de l'API : le métier et les workflows n'en savent rien (tag `type:policy`).

- `allowanceFor` : le droit d'une personne sur une action, d'après ses rôles et les politiques.
- `UsageGate` : réserver une unité avant une action (et la rendre si elle échoue), décrire ce qu'il reste.
- `HeldReservations` : les unités d'une action dont l'issue arrive après la réponse (un tour d'Akari).
- Ports : `UsagePolicySource` (Supabase, table `usage_policies`) et `UsageLedger` (Firestore, collection
  `usage-counters`) ; `InMemoryUsageLedger` pour le développement, `@org/usage/testing` pour les tests.

- Tests : `npx nx vite:test usage`
- Lint : `npx nx lint usage`
- Types : `npx nx typecheck usage`
