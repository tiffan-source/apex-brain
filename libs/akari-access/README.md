# akari-access

Les droits d'une personne sur Akari : la règle de chaque rôle (limite de messages, fenêtre), le
journal des tours réussis, et la décision « peut-elle écrire à Akari ? ». Identité (tag
`type:identity`) : seules l'infrastructure et l'app la voient ; le workflow de l'assistant n'en sait
rien, il signale seulement ses tours réussis.

Un mécanisme du système, pas du métier : la lib n'a pas de cas d'usage (ni `usecases/`, ni
`Result`). Les cas d'usage sont réservés au métier, aux gestes des personnes qui utilisent Apex.

- `AkariAccess` : `check` avant un envoi (la décision : autorisé, aucune règle, quota épuisé),
  `record` à la fin d'un tour réussi.
- `decideAkariAccess` : la décision pure (rôles, règles, consommation, heure).
- Ports : `AkariRuleSource` (les règles des rôles), `AkariUsageJournal` (le journal d'usage),
  `Clock` ; versions en mémoire pour le développement et les tests (`@org/akari-access/testing`).

- Tests : `npx nx vite:test akari-access`
- Lint : `npx nx lint akari-access`
- Types : `npx nx typecheck akari-access`
