import { IdGenerator } from '@org/chore';
import { assign, fromPromise, setup } from 'xstate';
import { SystemContextProvider } from '../context/system-context.provider';
import {
  AI_SENDER_ID,
  WORKFLOW_READY_FOR_NEW_MESSAGE,
  WorkflowContext,
  WorkflowError,
} from '../model/workflow.model';
import {
  AIResponse,
  CallResult,
  IAIActor,
  IChatActor,
  IToolExecutionPolicy,
  IToolExecutor,
  IToolRegistry,
  RegisterMessageInput,
  RegisterMessageResult,
  ToolCall,
  ToolExecutionDecision,
} from './actors.protocols';

export type MachineDependencies = {
  chatService: IChatActor;
  aiService: IAIActor;
  toolExecutor: IToolExecutor;
  toolPolicy: IToolExecutionPolicy;
  toolRegistry: IToolRegistry;
  systemContextProvider: SystemContextProvider;
  /** Réserve les ids des messages avant leur écriture (écriture rejouable). */
  idGenerator: IdGenerator;
  /** Horloge des pannes, remplaçable dans les tests. */
  now?: () => Date;
};

export type WorkflowEvent =
  | { type: 'message.send'; prompt: string; objectiveId: string; userId: string }
  | { type: 'user.response'; permission: boolean };

type TurnInput = { objectiveId: string; userId: string };

export function initialWorkflowContext(): WorkflowContext {
  return {
    userId: '',
    prompt: '',
    aiResponse: null,
    objectiveId: '',
    aiProviderInteractionId: '',
    toolCallResults: [],
    currentToolCall: undefined,
    lastRegisteredMessage: undefined,
    pendingUserMessageId: undefined,
    pendingAIMessageId: undefined,
    lastError: undefined,
  };
}

/** Le prochain outil demandé par l'IA qui n'a pas encore de résultat. */
function nextToolCall(context: WorkflowContext): ToolCall | undefined {
  const response = context.aiResponse?.response;
  if (response?.responseType !== 'toolCall') return undefined;
  return response.toolCalls.find((toolCall) =>
    context.toolCallResults.every((result) => result.id !== toolCall.id),
  );
}

function hasCode(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
  );
}

export const getMachine = (deps: MachineDependencies) => {
  const now = deps.now ?? (() => new Date());

  const toWorkflowError = (error: unknown, step: string): WorkflowError => ({
    code: hasCode(error) ? error.code : 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : String(error),
    step,
    at: now().toISOString(),
  });

  /** Ce qu'un tour interrompu par une panne laisse dans le contexte : la panne, et rien d'en cours. */
  const failedTurn = (error: unknown, step: string): Partial<WorkflowContext> => ({
    lastError: toWorkflowError(error, step),
    aiResponse: null,
    toolCallResults: [],
    currentToolCall: undefined,
    pendingUserMessageId: undefined,
    pendingAIMessageId: undefined,
  });

  const systemInstruction = (input: TurnInput) =>
    deps.systemContextProvider.getContext({ objectiveId: input.objectiveId, userId: input.userId });

  return setup({
    types: {
      context: {} as WorkflowContext,
      events: {} as WorkflowEvent,
    },
    actors: {
      registerMessage: fromPromise<RegisterMessageResult, RegisterMessageInput>(({ input }) =>
        deps.chatService.registerMessage(input),
      ),
      generateResponse: fromPromise<
        AIResponse,
        TurnInput & { prompt: string; previousInteractionId?: string }
      >(({ input }) =>
        deps.aiService.getAIMessage({
          prompt: input.prompt,
          previousInteractionId: input.previousInteractionId,
          tools: deps.toolRegistry.getAll(),
          systemInstruction: systemInstruction(input),
        }),
      ),
      executeTool: fromPromise<CallResult, TurnInput & { toolCall: ToolCall }>(({ input }) =>
        deps.toolExecutor.execute(input.toolCall, { objectiveId: input.objectiveId, userId: input.userId }),
      ),
      sendToolCallResult: fromPromise<
        AIResponse,
        TurnInput & { interactionId: string; toolCallResult: CallResult[] }
      >(({ input }) =>
        deps.aiService.sendToolCallResult({
          interactionId: input.interactionId,
          toolCallResult: input.toolCallResult,
          tools: deps.toolRegistry.getAll(),
          systemInstruction: systemInstruction(input),
        }),
      ),
      checkToolPolicy: fromPromise<ToolExecutionDecision, TurnInput & { toolCall: ToolCall }>(({ input }) =>
        deps.toolPolicy.decide(
          input.toolCall,
          { objectiveId: input.objectiveId, userId: input.userId },
          input.toolCall.arguments,
        ),
      ),
    },
  }).createMachine({
    context: initialWorkflowContext(),
    id: 'conversationProcess',
    initial: WORKFLOW_READY_FOR_NEW_MESSAGE,
    states: {
      [WORKFLOW_READY_FOR_NEW_MESSAGE]: {
        on: {
          'message.send': {
            target: 'RegisteringUserMessageInConversation',
            description: 'The user send a new message with an external reference to the conversation',
            actions: assign({
              prompt: ({ event }) => event.prompt,
              objectiveId: ({ event }) => event.objectiveId,
              userId: ({ event }) => event.userId,
              pendingUserMessageId: () => deps.idGenerator.generateId(),
              pendingAIMessageId: undefined,
              lastError: undefined,
              aiResponse: null,
              toolCallResults: [],
              currentToolCall: undefined,
            }),
          },
        },
      },

      RegisteringUserMessageInConversation: {
        invoke: {
          src: 'registerMessage',
          id: 'messageGateway',
          input: ({ context }) => ({
            conversationExternalRef: context.objectiveId,
            ownerId: context.userId,
            senderId: context.userId,
            messageId: context.pendingUserMessageId ?? deps.idGenerator.generateId(),
            content: context.prompt,
          }),
          onDone: {
            target: 'SendingPromptToAI',
            actions: assign({
              lastRegisteredMessage: ({ event }) => event.output.message ?? undefined,
              pendingUserMessageId: undefined,
            }),
          },
          onError: {
            target: WORKFLOW_READY_FOR_NEW_MESSAGE,
            actions: assign(({ event }) => failedTurn(event.error, 'RegisteringUserMessageInConversation')),
          },
        },
      },

      SendingPromptToAI: {
        description: 'We are getting the prompt we send to the AI provider',
        invoke: {
          src: 'generateResponse',
          id: 'aiProvider',
          input: ({ context }) => ({
            prompt: context.prompt,
            objectiveId: context.objectiveId,
            userId: context.userId,
            previousInteractionId: context.aiProviderInteractionId || undefined,
          }),
          onDone: [
            {
              target: 'RegisteringAIResponseInConversation',
              guard: ({ event }) => event.output.response.responseType === 'text',
              actions: assign({
                aiResponse: ({ event }) => event.output,
                aiProviderInteractionId: ({ event }) => event.output.id,
                pendingAIMessageId: () => deps.idGenerator.generateId(),
              }),
            },
            {
              target: 'ExecutingAllTool',
              guard: ({ event }) => event.output.response.responseType === 'toolCall',
              actions: assign({
                aiResponse: ({ event }) => event.output,
                aiProviderInteractionId: ({ event }) => event.output.id,
              }),
            },
            {
              target: WORKFLOW_READY_FOR_NEW_MESSAGE,
              actions: assign(() => failedTurn(new UnexpectedAIResponseError(), 'SendingPromptToAI')),
            },
          ],
          onError: {
            target: WORKFLOW_READY_FOR_NEW_MESSAGE,
            actions: assign(({ event }) => failedTurn(event.error, 'SendingPromptToAI')),
          },
        },
      },

      RegisteringAIResponseInConversation: {
        invoke: {
          src: 'registerMessage',
          id: 'messageGateway',
          input: ({ context }) => ({
            conversationExternalRef: context.objectiveId,
            ownerId: context.userId,
            senderId: AI_SENDER_ID,
            messageId: context.pendingAIMessageId ?? deps.idGenerator.generateId(),
            content:
              context.aiResponse?.response.responseType === 'text'
                ? context.aiResponse.response.response
                : '',
          }),
          onDone: {
            target: WORKFLOW_READY_FOR_NEW_MESSAGE,
            actions: assign({
              aiResponse: null,
              toolCallResults: [],
              currentToolCall: undefined,
              pendingAIMessageId: undefined,
              lastRegisteredMessage: ({ event }) => event.output.message ?? undefined,
            }),
          },
          onError: {
            target: WORKFLOW_READY_FOR_NEW_MESSAGE,
            actions: assign(({ event }) => failedTurn(event.error, 'RegisteringAIResponseInConversation')),
          },
        },
      },

      ExecutingAllTool: {
        initial: 'PreparingNextTool',
        states: {
          PreparingNextTool: {
            entry: assign({ currentToolCall: ({ context }) => nextToolCall(context) }),
            always: [
              {
                target: 'CheckingExecutionPolicy',
                guard: ({ context }) => context.currentToolCall !== undefined,
              },
              { target: 'ExitingToolCalling' },
            ],
          },

          CheckingExecutionPolicy: {
            invoke: {
              src: 'checkToolPolicy',
              id: 'toolPolicy',
              input: ({ context }) => ({
                toolCall: context.currentToolCall as ToolCall,
                objectiveId: context.objectiveId,
                userId: context.userId,
              }),
              onDone: [
                { target: 'ExecutingTool', guard: ({ event }) => event.output.type === 'execute' },
                {
                  target: 'WaitingForUserPermission',
                  guard: ({ event }) => event.output.type === 'ask-user',
                },
                {
                  // La policy refuse l'outil (ex. outil non enregistré, appel halluciné par l'IA).
                  // On enregistre un résultat explicite pour ce toolCall afin de ne pas re-sélectionner
                  // le même outil en boucle (cf. filtre dans PreparingNextTool), puis on passe au suivant.
                  target: 'SavingDeniedToolExecution',
                  actions: assign({
                    toolCallResults: ({ context, event }) => {
                      const currentToolCall = context.currentToolCall as ToolCall;
                      const reason = 'reason' in event.output ? event.output.reason : 'Tool execution denied';
                      return [
                        ...context.toolCallResults,
                        {
                          id: currentToolCall.id,
                          functionName: currentToolCall.name,
                          result: `Tool execution denied: ${reason}`,
                        },
                      ];
                    },
                  }),
                },
              ],
              // Échec inattendu de la vérification de policy : on trace l'erreur comme résultat
              // d'outil au lieu de laisser l'exception remonter et planter la machine.
              onError: {
                target: 'SavingDeniedToolExecution',
                actions: assign({
                  toolCallResults: ({ context, event }) => {
                    const currentToolCall = context.currentToolCall as ToolCall;
                    return [
                      ...context.toolCallResults,
                      {
                        id: currentToolCall.id,
                        functionName: currentToolCall.name,
                        result: `Error checking tool policy: ${String(event.error ?? 'unknown error')}`,
                      },
                    ];
                  },
                }),
              },
            },
          },

          ExecutingTool: {
            invoke: {
              src: 'executeTool',
              id: 'toolProvider',
              input: ({ context }) => ({
                // Ici, un outil est forcément choisi : on n'entre dans ExecutingTool que par CheckingExecutionPolicy.
                toolCall: context.currentToolCall as ToolCall,
                objectiveId: context.objectiveId,
                userId: context.userId,
              }),
              onDone: {
                target: 'PreparingNextTool',
                actions: assign({
                  toolCallResults: ({ context, event }) => [...context.toolCallResults, event.output],
                }),
              },
              onError: {
                target: 'PreparingNextTool',
                actions: assign({
                  toolCallResults: ({ context }) => {
                    const currentToolCall = context.currentToolCall as ToolCall;
                    return [
                      ...context.toolCallResults,
                      {
                        id: currentToolCall.id,
                        functionName: currentToolCall.name,
                        result: 'Error executing tool: We did not get a valid response from the tool',
                      },
                    ];
                  },
                }),
              },
            },
          },

          SavingDeniedToolExecution: {
            always: 'PreparingNextTool',
          },

          WaitingForUserPermission: {
            on: {
              'user.response': [
                { target: 'ExecutingTool', guard: ({ event }) => event.permission },
                { target: 'SavingUserDeniedPermission' },
              ],
            },
          },

          SavingUserDeniedPermission: {
            entry: assign({
              toolCallResults: ({ context }) => {
                const currentToolCall = context.currentToolCall as ToolCall;
                return [
                  ...context.toolCallResults,
                  {
                    id: currentToolCall.id,
                    functionName: currentToolCall.name,
                    result: 'User denied permission to execute the tool',
                  },
                ];
              },
            }),
            always: 'PreparingNextTool',
          },

          ExitingToolCalling: {
            type: 'final',
          },
        },

        onDone: 'SendingCallResultToAI',
      },

      SendingCallResultToAI: {
        invoke: {
          src: 'sendToolCallResult',
          id: 'aiProvider',
          input: ({ context }) => ({
            interactionId: context.aiProviderInteractionId,
            toolCallResult: context.toolCallResults,
            objectiveId: context.objectiveId,
            userId: context.userId,
          }),
          onDone: [
            {
              target: 'RegisteringAIResponseInConversation',
              guard: ({ event }) => event.output.response.responseType === 'text',
              actions: assign({
                aiResponse: ({ event }) => event.output,
                aiProviderInteractionId: ({ event }) => event.output.id,
                pendingAIMessageId: () => deps.idGenerator.generateId(),
              }),
            },
            {
              target: 'ExecutingAllTool',
              guard: ({ event }) => event.output.response.responseType === 'toolCall',
              actions: assign({
                aiResponse: ({ event }) => event.output,
                aiProviderInteractionId: ({ event }) => event.output.id,
              }),
            },
            {
              target: WORKFLOW_READY_FOR_NEW_MESSAGE,
              actions: assign(() => failedTurn(new UnexpectedAIResponseError(), 'SendingCallResultToAI')),
            },
          ],
          onError: {
            target: WORKFLOW_READY_FOR_NEW_MESSAGE,
            actions: assign(({ event }) => failedTurn(event.error, 'SendingCallResultToAI')),
          },
        },
        // Les résultats envoyés appartiennent à cette interaction : une nouvelle série d'outils
        // repart de zéro (dans Apex, cette remise à zéro était posée dans `invoke` et ignorée).
        exit: assign({ toolCallResults: [], currentToolCall: undefined }),
      },
    },
  });
};

export type ConversationMachine = ReturnType<typeof getMachine>;

class UnexpectedAIResponseError extends Error {
  readonly code = 'AI_PROVIDER_FAILURE';

  constructor() {
    super('The AI provider returned a response that is neither a text nor a tool call');
  }
}
