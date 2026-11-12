# ADR 0008 — Claude, deuxième fournisseur d'IA d'Akari

- Statut : accepté
- Date : 2026-11-12

## Contexte

Akari parle à Gemini (API Interactions) derrière le port `InteractiveAIProvider` de `@org/ai`. Les
réponses de Gemini ne donnent pas satisfaction : Akari doit pouvoir passer à Claude, sans toucher au
workflow, aux outils ni aux clients.

Le port suit le modèle de Gemini : chaque échange rend un id d'interaction, que le workflow garde
(`aiProviderInteractionId`, persisté dans Firestore) et renvoie au suivant (`previousInteractionId`) ;
Gemini garde l'historique de son côté. L'API Messages de Claude, elle, ne garde rien d'un appel à
l'autre : chaque appel envoie toute la conversation.

## Décision

- **`libs/claude`** (`type:infra`) implémente `InteractiveAIProvider` avec le SDK officiel
  `@anthropic-ai/sdk`, sur l'API Messages (stable). Le port, le workflow et l'API HTTP ne changent pas.
- **L'historique est gardé chez nous.** L'id d'interaction est l'id du message rendu par Claude
  (`msg_…`). Sous cet id, l'adaptateur enregistre tout l'échange jusqu'à ce message, et le relit pour
  l'appel suivant : nouveau port `InteractionHistoryRepository` dans `@org/ai`. Le lint interdit à
  une lib d'infrastructure d'en importer une autre : comme `IWorkflowStateRepository`, le port vit
  hors de l'infrastructure, son adaptateur Firestore dans `libs/firebase`.
- **Un historique écrit ne change plus.** Un workflow restauré relance l'étape interrompue (ADR 0004) :
  elle repart du même historique et en écrit un nouveau, sans rien doubler. Une réponse inexploitable
  n'écrit rien : l'interaction précédente reste la bonne.
- **Il vit avec l'état des workflows** (`WORKFLOW_STATE_STORE`) : Firestore (collection
  `ai-interaction-histories`, messages en JSON à cause des tableaux imbriqués) ou la mémoire. Un seul
  interrupteur : workflows et historiques ne peuvent pas se désaccorder (l'un persisté, l'autre perdu).
- **Les cas limites ne bloquent jamais une conversation :**
  - interaction sans historique (id de Gemini gardé par un workflow d'avant le changement, mémoire
    perdue au redémarrage) : un nouveau message repart de zéro, avec un avertissement dans les logs.
    Des résultats d'outils pour elle échouent (`AI_PROVIDER_FAILURE`), le tour revient au repos ;
  - tour interrompu pendant ses outils : l'API refuse un message qui ne répond pas d'abord à chaque
    `tool_use` en suspens. Le message suivant les clôt par un résultat en erreur
    (« No result: the previous turn was interrupted… ») ;
  - au-delà de 200 000 octets de JSON (de l'ordre de 50 000 tokens), les tours les plus anciens ne
    sont plus envoyés. On coupe au début d'un tour, jamais entre un outil et son résultat. Le coût
    d'un appel est borné, et l'historique reste loin du million d'octets d'un document Firestore ;
  - `refusal`, `model_context_window_exceeded`, `max_tokens` sans texte : `AIProviderError`. Un texte
    tronqué par `max_tokens` est rendu tel quel ; une réponse vide n'est pas gardée dans l'historique
    (l'API refuserait un message vide).
- **Cache de prompt automatique** (`cache_control` au niveau de la requête) : outils, instructions et
  échanges déjà envoyés sont relus depuis le cache à l'appel suivant, à une fraction du prix.
- **Le fournisseur se choisit à la configuration** : `AI_PROVIDER=gemini|claude` (Gemini par défaut :
  la fusion ne change rien en production), `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (défaut
  `claude-sonnet-5-5`). Seule la clé du fournisseur choisi est exigée au démarrage. Plafond d'une
  réponse : 8 192 tokens, réflexion comprise. Les blocs de réflexion repartent tels quels avec leur
  signature.
- **Les pannes du SDK deviennent des `AIProviderError` lisibles** : statut HTTP, type et cause donnés
  par Anthropic, son message, l'en-tête `request-id`, et la variable à vérifier (clé, modèle,
  facturation). Le SDK réessaie déjà deux fois les pannes passagères (429, 5xx, 529).

## Alternatives écartées

- **Fils de messages côté serveur** (bêta `message-threads-2026-08-12` : `thread` et
  `previous_message_id`), le modèle de Gemini chez Anthropic. Mais c'est une bêta ; une réponse ne
  peut être poursuivie qu'une fois (`thread_already_continued`), alors que le workflow rejoue une étape
  après un redémarrage ou une panne réseau ; et chaque échec d'un fil (`thread_not_found`,
  `thread_fingerprint_mismatch` quand les instructions d'Akari changent) se rattrape en renvoyant
  toute la conversation. Il faudrait garder l'historique de toute façon.
- **Historique en mémoire seulement** : perdu à chaque redémarrage (déploiement, mise en veille de
  l'instance). Une demande d'accord en attente ne pourrait plus aboutir, alors que le workflow, lui,
  est restauré depuis Firestore.
- **Un port qui reçoit tout l'historique** : le workflow garderait la conversation au format d'un
  fournisseur, que Gemini n'utilise pas. Le port reste celui d'Apex.

## Conséquences

- Passer à Claude : `AI_PROVIDER=claude` et `ANTHROPIC_API_KEY` sur Render. Revenir à Gemini :
  `AI_PROVIDER=gemini`. Aucun changement de code.
- Au changement, la mémoire d'Akari repart de zéro pour les conversations en cours ; leurs messages
  restent affichés (ils sont dans Supabase), et Akari relit l'arbre de l'objectif avec ses outils.
- Les conversations partent chez Anthropic, comme elles partaient chez Google.
- `ai-interaction-histories` grandit d'un document par appel à Claude, et rien ne les supprime, pas
  même la suppression de l'objectif (les historiques ne connaissent pas les objectifs ; Gemini gardait
  lui aussi les interactions). À prévoir : une expiration (politique TTL de Firestore, sur un champ
  date à ajouter) et l'effacement avec l'objectif.
- Chaque appel renvoie la conversation, jusqu'à la borne de 200 000 octets ; le cache en allège le prix.
- Non vérifié ici : l'appel réel à Claude (pas de clé dans l'environnement de travail). Le SDK est
  vérifié face à un faux serveur HTTP, et un test e2e mène un tour complet du workflow sur
  l'adaptateur (outil, accord de la personne, message suivant).
