import { RegisteredMessage, ToolCall } from './actors.protocols';
import {
  WORKFLOW_READY_FOR_NEW_MESSAGE,
  WorkflowActivityEntry,
  WorkflowActivityStep,
  WorkflowContext,
  WorkflowStateValue,
} from '../model/workflow.model';

export type WorkflowStatus = 'ready' | 'processing' | 'awaiting-permission';

/** Ce que fait l'assistant pendant un tour : le contrat public, sans rien de la machine. */
export type WorkflowActivityView = {
  /** Ce qu'il fait maintenant. */
  step: WorkflowActivityStep;
  /** Le temps déjà passé sur cette étape, en millisecondes (mesuré par le serveur). */
  elapsedMs: number;
  /** Ses passages par l'IA depuis le début du tour : à partir de 2, il repart pour un tour de boucle. */
  round: number;
  /**
   * Ce qu'il a déjà fait pendant ce tour, du plus ancien au plus récent. Une étape y figure parce qu'elle a eu
   * lieu, quel qu'en soit le résultat : une écriture refusée par un outil reste `writing`.
   */
  done: WorkflowActivityStep[];
};

/**
 * L'état d'un workflow tel que les clients le lisent : une forme stable, détachée du snapshot
 * XState (qui reste un détail interne et persisté).
 */
export type WorkflowStateView = {
  objectiveId: string;
  /**
   * La valeur de la machine.
   * @deprecated Les clients lisent `activity`. Gardé pour les versions déjà installées, à retirer ensuite.
   */
  value: WorkflowStateValue;
  status: WorkflowStatus;
  /** Ce que fait l'assistant ; null au repos. */
  activity: WorkflowActivityView | null;
  /** L'outil qui attend l'accord de la personne, quand `status` vaut `awaiting-permission`. */
  pendingToolCall: ToolCall | null;
  /** Le dernier message enregistré par le workflow (de la personne ou de l'assistant). */
  lastRegisteredMessage: RegisteredMessage | null;
  /** La panne qui a interrompu le dernier tour (son message technique n'est pas exposé). */
  lastError: { code: string; step: string; at: string } | null;
};

export function isAwaitingPermission(value: WorkflowStateValue | undefined): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['ExecutingAllTool'] === 'WaitingForUserPermission'
  );
}

/** Un workflow au repos n'a aucune étape en cours : prêt pour un message, ou en attente d'un accord. */
export function isRestingValue(value: WorkflowStateValue | undefined): boolean {
  return value === WORKFLOW_READY_FOR_NEW_MESSAGE || isAwaitingPermission(value);
}

export function statusOf(value: WorkflowStateValue): WorkflowStatus {
  if (value === WORKFLOW_READY_FOR_NEW_MESSAGE) return 'ready';
  if (isAwaitingPermission(value)) return 'awaiting-permission';
  return 'processing';
}

/** Les étapes qui interrogent l'IA. */
const AI_STEPS: readonly WorkflowActivityStep[] = ['thinking', 'reviewing'];

function toActivityView(
  journal: WorkflowActivityEntry[] | undefined,
  now: Date,
): WorkflowActivityView | null {
  const current = journal?.at(-1);
  if (!journal || !current) return null;

  return {
    step: current.step,
    elapsedMs: Math.max(0, now.getTime() - Date.parse(current.at)),
    round: journal.filter(({ step }) => AI_STEPS.includes(step)).length,
    done: journal.slice(0, -1).map(({ step }) => step),
  };
}

export function toWorkflowStateView(
  objectiveId: string,
  snapshot: { value: WorkflowStateValue; context: WorkflowContext },
  now: Date,
): WorkflowStateView {
  const { value, context } = snapshot;
  const status = statusOf(value);
  const message = context.lastRegisteredMessage;

  return {
    objectiveId,
    value,
    status,
    activity: toActivityView(context.activity, now),
    pendingToolCall: status === 'awaiting-permission' ? (context.currentToolCall ?? null) : null,
    lastRegisteredMessage: message ? { ...message, createdAt: new Date(message.createdAt) } : null,
    lastError: context.lastError
      ? { code: context.lastError.code, step: context.lastError.step, at: context.lastError.at }
      : null,
  };
}

/** L'état d'un workflow qui n'a encore jamais servi : prêt, sans historique. */
export function initialWorkflowStateView(objectiveId: string): WorkflowStateView {
  return {
    objectiveId,
    value: WORKFLOW_READY_FOR_NEW_MESSAGE,
    status: 'ready',
    activity: null,
    pendingToolCall: null,
    lastRegisteredMessage: null,
    lastError: null,
  };
}
