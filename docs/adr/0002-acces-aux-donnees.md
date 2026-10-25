# ADR 0002 — Accès aux données : clé secrète et propriété explicite

- Statut : accepté
- Date : 2026-10-25

## Contexte

Dans Apex, le navigateur appelait Supabase avec la clé publique et le jeton de la personne : la
RLS garantissait qu'on ne lisait et n'écrivait que ses propres lignes. Les ports du domaine en
dépendaient sans le dire : `ObjectiveRepository.findById(id)` n'a pas de notion de propriétaire.

Le serveur a deux sortes de travail :

1. les requêtes HTTP, faites au nom de la personne qui porte le jeton ;
2. l'orchestrateur, qui écrit des messages et exécute les outils de l'IA (créer une étape, un pas)
   après la fin de la requête, parfois plusieurs minutes plus tard quand il attend un accord, et
   qui reprend après un redémarrage. Le jeton de la personne (une heure de validité) n'est alors
   plus là.

## Options

- **Client Supabase par requête avec le jeton de la personne (RLS).** Le domaine ne change pas,
  mais l'orchestrateur devrait garder des jetons en mémoire et ne pourrait rien faire après un
  redémarrage.
- **Clé secrète côté serveur, propriété dans le domaine.** Le serveur est de confiance ; chaque
  port reçoit l'`ownerId` et chaque adaptateur filtre dessus.

## Décision

Clé secrète côté serveur, propriété explicite :

- `ObjectiveRepository.findById(id, ownerId)`, `findObjectiveWithASpecificTaskId(taskId, ownerId)`,
  `TaskRepository.findById(taskId, ownerId)`, `update(task, ownerId)`,
  `GetConversationsQuery.execute({ externalReferenceId, ownerId })`… Un élément qui n'appartient
  pas à la personne est « introuvable » (`404`), on ne révèle pas son existence.
- Les adaptateurs Supabase filtrent sur `user_id` (sur `objectives.user_id` par jointure pour
  les conversations).
- La RLS reste active en base : la clé publique circule encore dans les clients et l'API de
  données de Supabase reste joignable directement.
- Le client de données du serveur ne se connecte jamais : les connexions (`signInWithPassword`,
  `refreshSession`) passent par des clients éphémères, sinon le jeton d'une personne remplacerait
  la clé secrète pour toutes les requêtes suivantes.

## Conséquences

- La propriété devient une règle métier testée sans base de données (doublures en mémoire) et
  vérifiée sur un vrai Supabase par les tests d'intégration.
- Une requête d'adaptateur qui oublierait le filtre fuirait des données : chaque nouvel
  adaptateur passe par un test d'intégration qui vérifie l'isolation entre deux personnes.
