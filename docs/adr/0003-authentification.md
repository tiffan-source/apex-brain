# ADR 0003 — Authentification par Supabase Auth, derrière l'API

- Statut : accepté
- Date : 2026-10-25

## Contexte

Apex appelait Supabase Auth depuis le navigateur ; `supabase-js` y gardait la session et la
renouvelait. Avec le serveur, les clients web et mobile ne parlent plus qu'à l'API. Supabase
reste le fournisseur d'identité.

## Décision

- L'API expose `POST /v1/auth/register`, `/login`, `/refresh`, `/logout` et `GET /v1/auth/me`.
  `login`, `register` et `refresh` rendent une session : `accessToken`, `refreshToken`,
  `expiresAt`. Le client la garde et envoie `Authorization: Bearer <accessToken>`.
- Une garde globale vérifie le jeton à chaque requête par `GetCurrentUserUseCase`, qui s'appuie
  sur `AuthProvider.whoAmI(accessToken)`. L'adaptateur Supabase utilise `auth.getClaims()` :
  vérification locale avec les clés de signature asymétriques (JWKS mis en cache), repli sur le
  serveur d'auth pour les projets encore en HS256. Seul un jeton `role = authenticated` avec un
  `sub` est accepté (une clé publique ou secrète n'est pas une personne).
- Les routes publiques sont marquées `@Public()` ; tout le reste exige un jeton.
- `logout` révoque la session côté Supabase (`auth.admin.signOut`).
- Les erreurs portent des codes stables : `INVALID_CREDENTIALS`, `USER_ALREADY_EXIST`,
  `WEAK_PASSWORD`, `EMAIL_NOT_CONFIRMED`, `INVALID_SESSION`, `UNAUTHENTICATED`.
- Les routes d'authentification ont une limitation de débit plus stricte.

## Conséquences

- Le port `AuthProvider` devient sans état : chaque méthode reçoit ce dont elle a besoin.
- Avec la confirmation d'e-mail activée, `register` rend `session: null` jusqu'à confirmation.
- Le renouvellement est à la charge du client (`refresh` avant `expiresAt`, ou sur un `401`).
- Avec des clés de signature asymétriques, un jeton d'accès est vérifié sans appeler Supabase :
  après `logout`, il reste accepté jusqu'à son expiration (une heure au plus), alors que le jeton
  de renouvellement, lui, est révoqué tout de suite. Avec le secret HS256 (Supabase local), la
  vérification passe par le serveur d'auth et la révocation est immédiate.
- Le serveur d'auth injoignable donne une erreur `500`, jamais un `401` : un client ne
  déconnecte pas la personne pour une panne.
