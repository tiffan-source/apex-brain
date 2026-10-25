import { RegisteredMessage, ToolCall } from './actors.protocols';
import { WORKFLOW_READY_FOR_NEW_MESSAGE, WorkflowContext, WorkflowStateValue } from '../model/workflow.model';

export type WorkflowStatus = 'ready' | 'processing' | 'awaiting-permission';

/**
 * L'état d'un workflow tel que les clients le lisent : une forme stable, détachée du snapshot
 * XState (qui reste un détail interne et persisté).
 */
export type WorkflowStateView = {
  objectiveId: string;
  /** La valeur de la machine (les écrans d'Apex choisissent leur phrase d'après elle). */
  value: WorkflowStateValue;
  status: WorkflowStatus;
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

export function toWorkflowStateView(
  objectiveId: string,
  snapshot: { value: WorkflowStateValue; context: WorkflowContext },
): WorkflowStateView {
  const { value, context } = snapshot;
  const status = statusOf(value);
  const message = context.lastRegisteredMessage;

  return {
    objectiveId,
    value,
    status,
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
    pendingToolCall: null,
    lastRegisteredMessage: null,
    lastError: null,
  };
}
