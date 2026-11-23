# ADR 0010 — Le runtime des workflows et le bus d'événements

- Statut : accepté
- Date : 2026-11-23 (révisée le 2026-11-24 : le bus Redis, la livraison par instance, l'arrêt)

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
5. **Deux implémentations du bus**, choisies par la configuration (`EVENT_BUS`) : en mémoire quand
   l'API n'a qu'une instance, Redis (pub/sub, `libs/redis`) dès qu'elle en a plusieurs. Un abonné
   dit où il reçoit les événements (`delivery`) :
   - `one-instance` (par défaut) : sur l'instance qui publie, sans passer par Redis. Ce sont les
     réactions du serveur : un tour n'est compté qu'une fois, une panne journalisée qu'une fois, et
     ni l'un ni l'autre ne dépend de Redis.
   - `every-instance` : sur chaque instance, par Redis, celle qui publie comprise (un seul chemin,
     donc ni doublon ni désordre). C'est le flux SSE : le client est connecté à une instance, le
     tour tourne peut-être sur une autre.

   Avec le bus en mémoire, les deux reviennent au même.
6. **L'arrêt suit les dépendances.** Les flux SSE se terminent avant que le serveur HTTP ne ferme
   ses connexions (il attendrait sinon que chaque client s'en aille) ; le runtime termine ses
   sauvegardes et ses publications ; le bus se ferme en dernier, quand ses abonnés ont traité ce
   qu'ils ont reçu. Un abonné ne se désabonne pas avant : il perdrait les derniers faits.

Un événement est un fait (`turn.succeeded`), jamais un état de la machine : la règle de
l'[ADR 0005](./0005-activite-de-l-assistant.md) pour `activity` vaut pour les abonnés. Son
`audience` dit s'il peut sortir du serveur : `public` vers le client de la personne, `internal`
jamais (une panne porte un message technique).

## Conséquences

- Le workflow ne dépend plus ni du stockage, ni de ceux qui réagissent à ses tours.
- **Au plus une fois.** Un événement part après la sauvegarde de l'état qui l'a produit, mais il
  peut se perdre si le serveur tombe entre les deux, ou (Redis) si une instance est déconnectée au
  moment où il passe : Redis ne garde rien, et une publication perdue avec sa connexion n'est
  jamais renvoyée (Redis a pu la recevoir, elle serait livrée deux fois). Le comptage d'usage devient asynchrone, une fraction de seconde après la fin
  du tour : [#9](https://github.com/tiffan-source/apex-brain/issues/9) accepte déjà un léger
  dépassement. Un effet qui ne devra jamais se perdre demandera une boîte d'envoi : le runtime, qui
  tient à la fois la sauvegarde et la publication, pourra écrire les événements avec le snapshot et
  les republier après un redémarrage, sans toucher aux machines.
- L'ordre est garanti par instance et par abonné, pas d'une instance à l'autre.
- Redis injoignable au démarrage : le serveur ne démarre pas (une adresse fausse se voit tout de
  suite). Une coupure ensuite : chaque connexion se rétablit seule, la panne et le rétablissement
  sont journalisés une fois ; entre les deux, les flux des clients ne reçoivent plus rien, les
  réactions du serveur continuent. Un client retrouve l'état à sa reconnexion.
- Plusieurs instances de l'API : Redis transporte les événements de l'une à l'autre, mais la
  contrainte de l'[ADR 0004](./0004-orchestrateur.md) demeure, une même conversation ne doit
  vivre que sur une instance à la fois. Or lire l'état d'une conversation (`GET …/assistant`,
  l'ouverture du flux SSE) sur une instance qui ne l'héberge pas la restaure là aussi, et un
  snapshot restauré relance l'étape en cours : deux instances joueraient le même tour. Point
  ouvert, à régler avant d'en lancer plusieurs (routage par objectif, verrou partagé, ou lecture
  de l'état stocké sans restauration ailleurs que sur l'instance qui l'héberge).
- Le runtime hébergera les prochains workflows.
