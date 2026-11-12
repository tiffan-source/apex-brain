# user

La personne dans Apex : modèle `User` et ses rôles (`Role`). Ne sait pas comment on se connecte
(`libs/auth` en dépend, pas l'inverse), et les domaines métier ne la voient pas : ils ne reçoivent
que l'id du propriétaire (tag `type:identity`, voir `docs/adr/0008-roles.md`).

- Tests : `npx nx vite:test user`
- Lint : `npx nx lint user`
- Types : `npx nx typecheck user`
