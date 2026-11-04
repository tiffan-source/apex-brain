import { AIResponse, CallResult, RegisteredMessage, ToolCall } from '../workflow/actors.protocols';

/** La panne qui a interrompu un tour : le tour est revenu au repos, la personne peut réessayer. */
export type WorkflowError = {
  /** Code stable (`AI_PROVIDER_FAILURE`, `CONVERSATION_NOT_FOUND`, `TURN_INTERRUPTED`…). */
  code: string;
  /** Message technique, pour les journaux : jamais montré tel quel. */
  message: string;
  /** L'étape du workflow où la panne est survenue. */
  step: string;
  /** Instant de la panne (ISO 8601). */
  at: string;
};

/**
 * Ce que fait l'assistant pendant un tour, en codes publics et stables. C'est tout ce que les clients
 * apprennent du déroulement d'un tour : ni l'IA, ni les outils, ni les états de la machine n'y paraissent,
 * et la machine peut changer sans que ces codes changent.
 */
export const WORKFLOW_ACTIVITY_STEPS = [
  /** Il enregistre le message de la personne. */
  'saving-message',
  /** Il réfléchit à la demande (premier passage par l'IA). */
  'thinking',
  /** Il vérifie si ce qu'il veut faire demande l'accord de la personne. */
  'checking-permission',
  /** Il attend l'accord de la personne. */
  'awaiting-permission',
  /** Il lit les données de la personne. */
  'reading',
  /** Il écrit ce que la personne a accepté. */
  'writing',
  /** Il fait le point sur ce qu'il vient de faire (nouveau passage par l'IA). */
  'reviewing',
  /** Il enregistre sa réponse. */
  'saving-reply',
] as const;

export type WorkflowActivityStep = (typeof WORKFLOW_ACTIVITY_STEPS)[number];

/** Une étape du tour en cours : quoi, et depuis quand (ISO 8601). */
export type WorkflowActivityEntry = {
  step: WorkflowActivityStep;
  at: string;
};

/**
 * The data carried by a workflow throughout its execution.
 *
 * This is the single source of truth for the workflow shape: it both describes
 * the workflow in memory and models what we persist in the database.
 */
export type WorkflowContext = {
  userId: string;
  prompt: string;
  aiResponse: AIResponse | null;
  objectiveId: string;
  aiProviderInteractionId: string;
  toolCallResults: CallResult[];
  currentToolCall?: ToolCall;
  /**
   * The last message the workflow persisted in the conversation (user or AI),
   * carried here so the chat UI can display it from the workflow snapshot
   * instead of reloading the whole conversation.
   */
  lastRegisteredMessage?: RegisteredMessage;
  /** L'id réservé au message de la personne, avant son écriture. */
  pendingUserMessageId?: string;
  /** L'id réservé à la réponse de l'assistant, avant son écriture. */
  pendingAIMessageId?: string;
  /** La panne du dernier tour, effacée au message suivant. */
  lastError?: WorkflowError;
  /**
   * Le journal du tour en cours, de la première étape à l'étape en cours (la dernière), vide au repos.
   * Il garde les étapes trop brèves pour qu'une interrogation chaque seconde les voie passer. Absent des
   * états persistés avant son arrivée.
   */
  activity?: WorkflowActivityEntry[];
};

/**
 * The current position of a workflow.
 *
 * It is either a single step name, or a nested map when the workflow is in a
 * composed step (a step that itself has an active sub-step).
 */
export type WorkflowStateValue = string | { [step: string]: WorkflowStateValue };

/**
 * The state a workflow sits in when it is idle and ready to accept a brand new
 * user message. Exposed as a constant so the machine and the UI gate the chat
 * input on the same value instead of each duplicating the string literal.
 */
export const WORKFLOW_READY_FOR_NEW_MESSAGE = 'Ready For New Message';

/** La valeur du workflow quand il attend que la personne accepte ou refuse un outil. */
export const WORKFLOW_AWAITING_PERMISSION: WorkflowStateValue = {
  ExecutingAllTool: 'WaitingForUserPermission',
};

/** L'auteur des messages de l'assistant dans la conversation (valeur héritée d'Apex). */
export const AI_SENDER_ID = 'AI';

/**
 * A persisted workflow: its identifier, its current position and its data.
 */
export type WorkflowState = {
  id: string;
  value: WorkflowStateValue;
  context: WorkflowContext;
  /**
   * Le snapshot XState complet (`actor.getPersistedSnapshot()`), opaque pour le stockage : il
   * contient les étapes en cours, que la restauration relance. Absent des documents écrits par Apex.
   */
  persistedSnapshot?: unknown;
  /** Dernière écriture (ISO 8601). */
  updatedAt?: string;
};

/**
 * Port for persisting and retrieving a workflow's state.
 *
 * Implemented by infrastructure adapters (e.g. Firestore in `@org/firebase`).
 */
export abstract class IWorkflowStateRepository {
  abstract save(state: WorkflowState): Promise<void>;
  abstract findById(id: string): Promise<WorkflowState | null>;
  /** Sans effet si ce workflow n'a pas d'état persisté. */
  abstract delete(id: string): Promise<void>;
}
