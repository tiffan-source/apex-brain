# PRD — Send Message to AI

> Document repris d'Apex. Le workflow vit désormais dans `workflows/ai-assistant` d'Apex Brain et
> tourne dans le serveur ; ce qui a changé depuis (persistance du snapshot complet, `onError`,
> contexte système, propriété) est décrit dans `docs/adr/0004-orchestrateur.md`.

## 1. Objet

### 1.1. Fonctionnalité

Permettre à un utilisateur d'envoyer un message à l'IA depuis la conversation associée à un objectif.

Le workflow `SendMessageToAI` est responsable de l'orchestration complète de cette opération :

1. enregistrer le message de l'utilisateur dans la conversation ;
2. récupérer les éléments nécessaires à la construction du contexte ;
3. construire le contexte destiné à l'IA ;
4. demander à l'IA de générer une réponse ;
5. attendre la fin complète de la génération ;
6. enregistrer la réponse de l'IA dans la conversation ;
7. retourner le résultat au client.

### 1.2. Périmètre actuel

Le workflow est volontairement synchrone du point de vue de son appelant :

> le workflow ne retourne qu'après avoir obtenu la réponse complète de l'IA.

Les mécanismes de streaming, de suivi de progression, d'événements, de signaux ou de traitement asynchrone sont explicitement hors périmètre pour cette première version.

L'architecture doit cependant éviter de rendre ce fonctionnement impossible à faire évoluer.

---

# 2. Décisions architecturales

## 2.1. Conversation

`Conversation` est un concept métier autonome.

Elle est actuellement associée à un objectif selon la règle :

> un objectif possède exactement une conversation.

Cette relation ne signifie pas que `Conversation` appartient au module `Objective`.

Le module `chat` reste responsable du concept de conversation et de ses messages.

Aujourd'hui :

```text
Objective 1 ───── 1 Conversation
```

Cette contrainte pourra évoluer plus tard vers plusieurs conversations par objectif ou vers des conversations globales à l'utilisateur sans remettre en cause l'existence du module `chat`.

## 2.2. Workflow

`SendMessageToAI` n'appartient ni à `chat`, ni à `objective`, ni à `ai`.

Il s'agit d'un workflow applicatif transversal.

La structure retenue est :

```text
workflow/
└── ai-assistant/
    └── send-message-to-ai/
```

Le workflow orchestre plusieurs capacités métier et techniques sans devenir propriétaire de leurs concepts.

Conceptuellement :

```text
                    SendMessageToAI
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
        Chat           Objective           AI
```

Ainsi :

- `chat` ne dépend pas de `ai` ;
- `chat` ne dépend pas de `objective` ;
- `objective` ne dépend pas de `ai` ;
- `ai` ne dépend pas de `chat` ou `objective` ;
- `SendMessageToAI` peut dépendre des abstractions nécessaires de ces modules.

## 2.3. AI et Gemini

`ai` définit la capacité abstraite permettant de demander une génération à une IA.

`gemini` fournit l'implémentation concrète de cette capacité.

Le workflow `SendMessageToAI` ne doit jamais dépendre directement de `gemini`.

La dépendance doit rester :

```text
SendMessageToAI
       |
       v
      AI
       ^
       |
    Gemini
```

Le workflow travaille donc avec une abstraction telle que `AIProvider`, et l'infrastructure choisit l'implémentation concrète.

## 2.4. Infrastructure

Le workflow ne doit pas connaître Firebase, Supabase ou Gemini.

Il ne doit pas contenir de :

```typescript
firebase/firestore
```

ni de dépendance directe à une classe concrète Gemini.

Les implémentations concrètes sont injectées au workflow.

La direction de dépendance recherchée est :

```text
Workflow
   |
   +----> Domain/application abstractions
                     ^
                     |
              Infrastructure
```

---

# 3. Scénario fonctionnel

## 3.1. Scénario nominal

L'utilisateur est positionné sur un objectif et saisit :

```text
"Comment puis-je progresser plus rapidement ?"
```

Le client appelle :

```text
SendMessageToAI
```

avec au minimum :

```text
objectiveId
message
```

Le workflow :

```text
1. identifie la conversation de l'objectif
2. enregistre le message utilisateur
3. récupère l'historique de la conversation
4. récupère la structure complète de l'objectif
5. construit le contexte système
6. assemble le contexte IA
7. appelle l'AIProvider
8. attend la réponse complète
9. enregistre la réponse de l'IA
10. retourne la réponse
```

---

# 4. Modèle du contexte IA

Le contexte envoyé à l'IA est composé de trois sources.

## 4.1. Historique de conversation

L'historique permet à l'IA de comprendre les échanges précédents.

Il contient les messages de la conversation, dans leur ordre chronologique.

Exemple conceptuel :

```text
USER:
...

ASSISTANT:
...

USER:
...

ASSISTANT:
...
```

Le message courant de l'utilisateur doit être inclus dans l'historique/contexte après son enregistrement.

## 4.2. Structure complète de l'objectif

Le contexte doit contenir la représentation complète de l'objectif concerné.

Cela inclut notamment, selon le modèle métier actuel :

- l'objectif principal ;
- ses informations métier ;
- ses sous-objectifs ;
- ses tâches ;
- les autres informations nécessaires à la compréhension de sa structure.

Le workflow ne doit pas reconstruire lui-même les règles de construction d'un objectif.

Il doit demander au module `objective` les données nécessaires et utiliser son modèle ou son abstraction de lecture.

## 4.3. Contexte système

Le produit fournit également des instructions système destinées à orienter le comportement de l'IA.

Ce contexte est contrôlé par l'application et n'est pas fourni par l'utilisateur.

Exemples de responsabilités possibles :

- définir le rôle de l'assistant ;
- expliquer ce qu'est l'application ;
- préciser la manière dont l'IA doit interpréter l'objectif ;
- définir des contraintes de comportement ;
- demander à l'IA de ne pas inventer des informations absentes du contexte.

La gestion détaillée du contenu de ces instructions doit rester indépendante de `Conversation`.

---

# 5. Architecture du workflow

Le workflow doit rester un orchestrateur.

Il ne doit pas contenir toute la logique métier de `chat`, `objective` ou `ai`.

Conceptuellement :

```text
SendMessageToAI
│
├── ConversationGateway
│     ├── getConversationForObjective()
│     ├── getMessages()
│     ├── addUserMessage()
│     └── addAssistantMessage()
│
├── ObjectiveReader
│     └── getCompleteObjective()
│
├── AIContextBuilder
│     ├── conversation history
│     ├── objective
│     └── system context
│
└── AIProvider
      └── generate()
```

Le workflow orchestre ces briques.

---

# 6. Ports et services

## 6.1. Conversation

Le workflow doit dépendre d'une abstraction permettant de :

- retrouver la conversation liée à l'objectif ;
- récupérer son historique ;
- ajouter un message utilisateur ;
- ajouter la réponse de l'IA.

Exemple conceptuel :

```typescript
interface ConversationGateway {
  getForObjective(objectiveId: ObjectiveId): Promise<Conversation>;
  getMessages(conversationId: ConversationId): Promise<Message[]>;
  addMessage(
    conversationId: ConversationId,
    message: Message
  ): Promise<void>;
}
```

Le nom exact des interfaces doit être adapté aux abstractions déjà présentes dans `libs/chat`.

Il ne faut pas créer une deuxième définition concurrente de `ConversationRepository` si `chat` expose déjà une abstraction équivalente.

## 6.2. Objective

Le workflow a besoin d'une lecture complète de l'objectif.

Il doit utiliser l'abstraction déjà exposée par `libs/objective`.

Exemple conceptuel :

```typescript
interface ObjectiveReader {
  getComplete(objectiveId: ObjectiveId): Promise<MainObjective>;
}
```

Le workflow ne doit pas connaître la structure Firestore ou la manière dont l'objectif est reconstruit.

La reconstruction d'un objectif à partir de plusieurs documents reste une responsabilité de `objective` / de son infrastructure.

## 6.3. AI

Le workflow dépend de l'abstraction exposée par `libs/ai`.

Exemple :

```typescript
interface AIProvider {
  generate(request: AIRequest): Promise<AIResponse>;
}
```

`AIRequest` doit représenter une requête générique à une IA, et non une requête spécifique à Gemini.

Le workflow ne doit donc pas faire :

```typescript
gemini.generate(...)
```

mais :

```typescript
aiProvider.generate(...)
```

## 6.4. AIContextBuilder

La construction du contexte est une responsabilité suffisamment distincte pour être isolée.

Exemple :

```typescript
interface AIContextBuilder {
  build(input: BuildAIContextInput): AIRequest;
}
```

Son rôle est de transformer :

```text
Conversation history
+
Objective
+
System instructions
```

en :

```text
AIRequest
```

Le workflow reste alors lisible :

```text
persist user message
        ↓
load context data
        ↓
build AI request
        ↓
generate response
        ↓
persist assistant message
```

---

# 7. Responsabilité du workflow

Le workflow est responsable de l'ordre des opérations.

Il doit exprimer le scénario métier/application :

```typescript
async execute(command: SendMessageToAICommand) {
  const conversation =
    await conversationGateway.getForObjective(command.objectiveId);

  await conversationGateway.addMessage(
    conversation.id,
    createUserMessage(command.message)
  );

  const history =
    await conversationGateway.getMessages(conversation.id);

  const objective =
    await objectiveReader.getComplete(command.objectiveId);

  const request =
    contextBuilder.build({
      history,
      objective,
      systemContext
    });

  const response =
    await aiProvider.generate(request);

  await conversationGateway.addMessage(
    conversation.id,
    createAssistantMessage(response)
  );

  return response;
}
```

Ce code est volontairement conceptuel.

Les détails des entités, factories, repositories et DTO doivent respecter les contrats déjà existants dans les libs concernées.

---

# 8. Ordre de persistance

Une décision importante est prise :

> Le message utilisateur est enregistré avant l'appel à l'IA.

Cela signifie que le message utilisateur existe même si la génération de l'IA échoue.

Exemple :

```text
USER message
     ↓
persisted
     ↓
build context
     ↓
AI generation
     ↓
failure
```

Dans cette première version, aucune gestion spécifique d'un message "failed", "processing" ou "pending" n'est imposée.

Le workflow peut simplement échouer après la persistance du message utilisateur.

Cette décision pourra être revue si le produit introduit plus tard :

- les statuts de traitement ;
- le retry ;
- le streaming ;
- la reprise d'un workflow interrompu ;
- les événements de progression.

---

# 9. Gestion de la réponse de l'IA

La première version utilise un modèle de génération complète :

```text
SendMessageToAI
       |
       v
AIProvider.generate()
       |
       | attente
       v
AIResponse complète
       |
       v
persist assistant message
       |
       v
return
```

Le workflow ne doit donc pas exposer de streaming dans sa première API.

Cela ne signifie pas que `AIProvider` doit être conçu de manière à rendre le streaming impossible.

L'abstraction doit rester suffisamment générale pour permettre une future évolution.

---

# 10. Évolution future : streaming et signaux

Le workflow actuel est volontairement synchrone.

Une évolution future pourrait introduire :

```text
SendMessageToAI
       |
       +── workflow state
       |
       +── events
       |
       +── response stream
       |
       +── progress notifications
```

Ou plusieurs processus spécialisés :

```text
SendMessageToAI
       |
       +── persist user message
       |
       +── start AI processing
                    |
                    +── context construction
                    +── AI generation
                    +── response persistence
                    +── events
```

Cette évolution ne doit pas imposer dès maintenant une architecture événementielle.

La version actuelle reste volontairement simple.

Le point important est que les dépendances entre `SendMessageToAI` et les capacités externes passent par des abstractions afin de pouvoir changer l'orchestration plus tard.

---

# 11. Gestion du contexte système

Le contexte système ne doit pas être écrit directement au milieu du workflow.

À terme, il doit être représenté par une abstraction ou une configuration dédiée.

Exemple :

```typescript
interface SystemContextProvider {
  getContext(): SystemContext;
}
```

Le workflow peut alors faire :

```text
SystemContextProvider
        ↓
AIContextBuilder
```

Cela permet de modifier les instructions données à l'IA sans modifier le workflow.

Pour la première version, une implémentation statique peut suffire.

---

# 12. Dépendances autorisées

La dépendance cible est :

```text
workflow/ai-assistant
        │
        ├──────────────► libs/chat
        │
        ├──────────────► libs/objective
        │
        └──────────────► libs/ai
```

Les implémentations concrètes restent en dehors du workflow :

```text
libs/gemini
      │
      └──────────────► libs/ai

libs/firebase
      │
      ├──────────────► libs/chat
      └──────────────► libs/objective
```

Le workflow ne doit pas dépendre directement de :

```text
libs/gemini
libs/firebase
libs/supabase
```

La composition finale de l'application fournit les implémentations concrètes aux abstractions attendues par le workflow.

---

# 13. Ce que chaque module ne doit PAS faire

## `chat`

Ne doit pas :

- appeler une IA ;
- connaître Gemini ;
- connaître les objectifs ;
- construire le contexte d'une requête IA ;
- décider comment une IA doit répondre.

Il connaît les conversations et les messages.

## `objective`

Ne doit pas :

- connaître l'IA ;
- connaître les conversations ;
- construire des prompts ;
- décider comment utiliser son contenu avec une IA.

Il connaît les objectifs et leur structure.

## `ai`

Ne doit pas :

- connaître les conversations ;
- connaître les objectifs ;
- récupérer des données métier ;
- construire le contexte spécifique de l'application.

Il fournit une capacité générique de génération.

## `gemini`

Ne doit pas :

- connaître les objectifs ;
- connaître les conversations ;
- connaître le workflow `SendMessageToAI`.

Il adapte Gemini au contrat de `ai`.

## `ai-assistant`

Peut :

- orchestrer `chat`, `objective` et `ai` ;
- construire le contexte spécifique à l'assistant ;
- définir le workflow `SendMessageToAI` ;
- décider de l'ordre des opérations ;
- coordonner la persistance et la génération.

Il ne doit pas :

- accéder directement à Firebase ;
- appeler directement Gemini ;
- implémenter les règles internes de `Objective` ou `Conversation`.

---

# 14. Contrat d'entrée

Le workflow reçoit uniquement les informations nécessaires à l'intention utilisateur.

Exemple :

```typescript
interface SendMessageToAICommand {
  objectiveId: string;
  content: string;
}
```

Le client n'a pas à fournir :

- la conversation complète ;
- l'historique ;
- l'objectif ;
- le prompt système ;
- le contexte IA.

Ces informations sont récupérées par le workflow.

Cela évite notamment qu'un client puisse décider arbitrairement du contexte envoyé à l'IA.

---

# 15. Contrat de sortie

Dans la première version, le workflow retourne la réponse complète de l'IA.

Conceptuellement :

```typescript
interface SendMessageToAIResult {
  message: Message;
}
```

ou, si le contrat `AIResponse` est suffisamment approprié :

```typescript
Promise<AIResponse>
```

La préférence est de retourner une représentation liée au workflow plutôt que d'exposer directement un objet spécifique à Gemini.

---

# 16. Erreurs

Le workflow doit distinguer au minimum :

```text
Conversation introuvable
Objectif introuvable
Impossible de récupérer l'historique
Impossible de construire le contexte
Échec de génération IA
Impossible de persister la réponse IA
```

Les erreurs techniques provenant de Firebase, Supabase ou Gemini ne doivent pas remonter directement comme contrats métier si les adapters concernés peuvent les traduire.

Par exemple :

```text
Gemini API error
       ↓
Gemini adapter
       ↓
AIProvider error
       ↓
SendMessageToAI
```

Le workflow ne doit pas connaître les détails HTTP ou SDK de Gemini.

---

# 17. Tests

Le workflow doit être testable sans Firebase ni Gemini.

Les dépendances sont remplacées par des doubles de test :

```text
FakeConversationGateway
FakeObjectiveReader
FakeAIProvider
FakeAIContextBuilder
FakeSystemContextProvider
```

Le test principal vérifie le scénario :

```text
given:
    objective exists
    conversation exists
    conversation has history
    objective can be loaded
    AI returns a response

when:
    SendMessageToAI.execute()

then:
    user message is persisted
    objective is loaded
    history is loaded
    context is built
    AI is called
    assistant response is persisted
    response is returned
```

Des tests doivent également vérifier les erreurs et l'ordre des opérations lorsque celui-ci constitue une règle du workflow.

---

# 18. Vue d'ensemble de l'architecture

```text
                         Angular / Client
                                |
                                v
                    SendMessageToAI Workflow
                                |
             +------------------+------------------+
             |                  |                  |
             v                  v                  v
        Chat Port         Objective Port        AI Port
             |                  |                  |
             v                  v                  v
        Chat module        Objective module     AI module
             |                                     |
             v                                     v
      Firebase/Supabase                         Gemini
       implementation                         adapter
```

La règle fondamentale est :

> Le workflow dépend des capacités abstraites dont il a besoin ; il ne dépend pas de leurs implémentations techniques.

---

# 19. Structure cible proposée

```text
workflow/
└── ai-assistant/
    └── send-message-to-ai/
        ├── application/
        │   ├── send-message-to-ai.ts
        │   ├── send-message-to-ai.command.ts
        │   └── ...
        │
        ├── services/
        │   ├── ai-context-builder.ts
        │   └── system-context-provider.ts
        │
        └── ...
```

La structure exacte peut être simplifiée si certains éléments ne justifient pas encore leur propre fichier.

Le principe important est de séparer :

```text
workflow
    = orchestration

services
    = opérations spécialisées utilisées par l'orchestration

ports
    = contrats vers les autres capacités

adapters
    = implémentations techniques
```

---

# 20. Décisions récapitulatives

| Décision | Choix |
|---|---|
| Conversation | Module autonome `chat` |
| Relation actuelle | 1 objectif → 1 conversation |
| `SendMessageToAI` | Workflow applicatif transversal |
| Emplacement | `workflow/ai-assistant/send-message-to-ai` |
| IA | Abstraction dans `libs/ai` |
| Gemini | Adapter dans `libs/gemini` |
| Conversation | Ne connaît pas l'IA |
| Objective | Ne connaît pas l'IA |
| AI | Ne connaît pas l'objectif ni la conversation |
| Contexte IA | Construit dans le workflow assistant |
| Historique | Récupéré depuis `chat` |
| Objectif | Récupéré depuis `objective` |
| System context | Fourni par l'assistant |
| Persistance du message utilisateur | Avant l'appel IA |
| Génération | Attente de la réponse complète |
| Streaming | Hors périmètre V1 |
| Signaux/événements | Hors périmètre V1 |
| Firebase/Supabase | Hors du workflow |
| Gemini SDK | Hors du workflow |
| Testabilité | Workflow testable avec des ports/fakes |

---

# 21. Principe directeur

La décision architecturale centrale de cette fonctionnalité est la suivante :

> **Une conversation est une capacité métier autonome. Une IA est une capacité de génération autonome. Un objectif est une capacité métier autonome. `SendMessageToAI` est le workflow qui compose ces capacités pour réaliser une intention utilisateur précise.**

Cette séparation permet de conserver la cohésion des modules selon le CCP/CRP tout en permettant au workflow d'évoluer indépendamment.

Le workflow peut donc devenir progressivement plus complexe sans transformer `chat`, `objective` ou `ai` en modules connaissant l'ensemble de l'application.
