# ADR 0004 — L'orchestrateur XState vit dans le serveur

- Statut : accepté
- Date : 2026-10-25

## Contexte

`SendMessageToAIWorkflow` (XState v5) orchestrait un tour de conversation avec Akari dans le
navigateur : enregistrer le message, interroger l'IA, exécuter les outils (avec l'accord de la
personne pour ceux qui écrivent), enregistrer la réponse. Un acteur par objectif, persisté dans
Firestore à chaque transition, interrogé chaque seconde par l'écran.

## Décision

- La machine et ses ports restent ceux d'Apex (`IChatActor`, `IAIActor`, `IToolExecutor`,
  `IToolExecutionPolicy`, `IToolRegistry`, `IWorkflowStateRepository`) ; le serveur les assemble.
- L'API expose l'état sous une forme stable (`docs/api.md`) plutôt que le snapshot XState brut :
  la valeur de la machine (`value`, pour les écrans existants), l'outil en attente d'accord, le
  dernier message enregistré, la dernière panne.
- **Persistance du snapshot complet** (`actor.getPersistedSnapshot()`), sérialisé en JSON dans
  Firestore. Restaurer un snapshot relance l'étape qui était en cours ; `resolveState` (Apex) ne
  le faisait pas et laissait le tour bloqué. Les anciens documents (`value` + `context`) restent
  lisibles.
- Les messages reçoivent leur id avant l'écriture, et l'écriture ignore un id déjà enregistré :
  une étape relancée ne double pas un message.
- Toute étape invoquée a un `onError` : le tour revient au repos avec `lastError`.
- Les sauvegardes d'un même workflow partent dans l'ordre ; les acteurs au repos sont libérés de
  la mémoire après un délai.
- Chaque accès vérifie que l'objectif (et sa conversation) appartient à la personne.

## Conséquences

- Un seul processus doit servir les workflows d'un même objectif (les acteurs vivent en mémoire).
  Plusieurs instances demanderont un routage par objectif ou un verrou partagé.
- L'interrogation chaque seconde est conservée pour la compatibilité ; un flux SSE la remplacera.
- Un outil d'écriture interrompu par un redémarrage pendant son exécution peut être rejoué.
