# ADR 0010 — Le runtime des workflows et le bus d'événements

- Statut : accepté
- Date : 2026-11-23

## Contexte

La lib du workflow de l'assistant (`workflows/ai-assistant`) portait de plus en plus de choses qui ne
sont pas son travail. Sa façade hébergeait les acteurs (un par objectif, restauration, éviction,
arrêt) et persistait chaque transition par un port de stockage ; la machine appelait un rappel
`onTurnSucceeded` pour le quota d'Akari ; la façade journalisait les pannes de tour. Chaque nouvelle
réaction à un tour (statistiques, notification, coût par modèle…) aurait ajouté un paramètre à la
machine. Et les clients interrogent l'état chaque seconde pour suivre un tour.

## Décision

1. **Un runtime générique héberge les workflows.** `workflows/runtime` (`@org/workflow-runtime`, tag
   `type:runtime`) garde une instance XState par clé : verrou par clé, création ou restauration
   (restaurer un snapshot relance l'étape en cours), sauvegarde ordonnée de chaque transition par le
   port `WorkflowStateStore`, éviction des instances au repos, arrêt, oubli. Il reçoit une
   définition (`WorkflowDefinition` : nom, machine munie de ses ports, `ownerOf`, `recover`,
   `isResting`) et ne sait rien d'autre. Un workflow n'apporte que sa machine, ses ports et les
   règles d'une requête (pour l'assistant : à qui la conversation, un tour en cours, un accord en
   attente).
2. **La machine annonce des faits ; le runtime les publie dans un bus.** La machine déclare ses
   événements avec l'action `emit` d'XState, sans dépendance. Le runtime est leur seul écouteur : il
   les enveloppe (`id`, `type` préfixé par le nom du workflow, `source`, `key`, `ownerId`,
   `audience`, `occurredAt`, `payload`), sauvegarde l'état qui les a produits, puis les publie,
   dans l'ordre. Le bus est un port (`EventBus`, `libs/event-bus`) : personne d'autre ne s'abonne
   aux acteurs, et une erreur d'abonné ne remonte jamais dans la machine.
3. **Les réactions sont des abonnés du bus**, branchés par l'API : le comptage d'usage d'Akari
   (`ai-assistant.turn.succeeded`), la journalisation des pannes (`ai-assistant.turn.failed`).
4. **Les clients suivent leurs événements par un flux SSE** : l'état au départ, puis les événements
   publics de la personne. Le flux remplace l'interrogation chaque seconde, pas la lecture de l'état :
   à chaque connexion, le client repart de l'état. Pour que le flux porte l'état, le runtime publie
   aussi, après chaque sauvegarde, la vue publique que donne la définition (`publicState`) : un
   événement public `<nom>.state.changed`, la même vue que la lecture de l'état.
5. **Deux implémentations du bus**, choisies par la configuration : en mémoire quand l'API n'a
   qu'une instance, Redis (pub/sub) dès qu'elle en a plusieurs.

Un événement est un fait (`turn.succeeded`), jamais un état de la machine : la règle de
l'[ADR 0005](./0005-activite-de-l-assistant.md) pour `activity` vaut pour les abonnés. Son
`audience` dit s'il peut sortir du serveur : `public` vers le client de la personne, `internal`
jamais (une panne porte un message technique).

## Conséquences

- Le workflow ne dépend plus ni du stockage, ni de ceux qui réagissent à ses tours.
- **Au plus une fois.** Un événement part après la sauvegarde de l'état qui l'a produit, mais il
  peut se perdre si le serveur tombe entre les deux, ou (Redis) si une instance est déconnectée au
  moment où il passe. Le comptage d'usage devient asynchrone, une fraction de seconde après la fin
  du tour : [#9](https://github.com/tiffan-source/apex-brain/issues/9) accepte déjà un léger
  dépassement. Un effet qui ne devra jamais se perdre demandera une boîte d'envoi : le runtime, qui
  tient à la fois la sauvegarde et la publication, pourra écrire les événements avec le snapshot et
  les republier après un redémarrage, sans toucher aux machines.
- L'ordre est garanti par instance et par abonné, pas d'une instance à l'autre.
- Plusieurs instances de l'API : Redis transporte les événements de l'une à l'autre, mais la
  contrainte de l'[ADR 0004](./0004-orchestrateur.md) demeure, une même conversation ne doit
  vivre que sur une instance à la fois (routage par objectif ou verrou partagé). Point ouvert.
- Le runtime hébergera les prochains workflows.
