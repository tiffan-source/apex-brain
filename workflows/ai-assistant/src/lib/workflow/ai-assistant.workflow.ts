import type { WorkflowDefinition } from '@org/workflow-runtime';
import { WORKFLOW_READY_FOR_NEW_MESSAGE, WorkflowContext, WorkflowStateValue } from '../model/workflow.model';
import {
  AssistantAnnouncement,
  ConversationMachine,
  getMachine,
  initialWorkflowContext,
  MachineDependencies,
} from './machine';
import { isRestingValue, toWorkflowStateView } from './workflow-state.view';

/** Le nom du workflow de l'assistant, pour le runtime. */
export const AI_ASSISTANT_WORKFLOW = 'ai-assistant';

/** Ce que l'assistant publie dans le bus (`AssistantAnnouncement`, préfixé par le nom du workflow). */
export const AI_ASSISTANT_EVENTS = {
  /** Akari a répondu, sa réponse est écrite. Public : `{ replyMessageId }`. */
  turnSucceeded: `${AI_ASSISTANT_WORKFLOW}.turn.succeeded`,
  /** Une panne a arrêté le tour. Interne : il porte le message technique, `{ code, step, message, at }`. */
  turnFailed: `${AI_ASSISTANT_WORKFLOW}.turn.failed`,
  /** L'état a changé. Public : l'état tel que `GET …/assistant` le rend (`WorkflowStateView`). */
  stateChanged: `${AI_ASSISTANT_WORKFLOW}.state.changed`,
} as const;

/** La charge d'un événement de l'assistant, d'après son annonce. */
export type AssistantEventPayload<TType extends AssistantAnnouncement['type']> = Omit<
  Extract<AssistantAnnouncement, { type: TType }>,
  'type'
>;

/**
 * Le workflow de l'assistant, tel que le runtime l'héberge : la machine munie de ses ports, et ce que le
 * runtime ne sait pas seul (à qui appartient un état stocké, comment relire un document d'Apex, quand une
 * instance est au repos, ce qui peut aller au client de la personne).
 */
export function aiAssistantWorkflow(deps: MachineDependencies): WorkflowDefinition<ConversationMachine> {
  const machine = getMachine(deps);

  return {
    name: AI_ASSISTANT_WORKFLOW,
    machine,
    publicEvents: ['turn.succeeded'],
    // Après chaque transition, l'état tel que les clients le lisent : le flux SSE le leur porte.
    publicState: (snapshot, key) =>
      toWorkflowStateView(
        key,
        { value: snapshot.value as WorkflowStateValue, context: snapshot.context },
        deps.now?.() ?? new Date(),
      ),
    ownerOf: (state) => state.context?.userId || undefined,
    isResting: (snapshot) => isRestingValue(snapshot.value as WorkflowStateValue),
    // Document d'Apex (valeur + contexte), ou snapshot inutilisable. Un état au repos se reprend tel quel ;
    // un tour qui était en cours ne peut pas être relancé : on revient au repos et on le dit.
    recover: (state) => {
      const value = state.value as WorkflowStateValue;
      const resting = isRestingValue(value);
      const context: WorkflowContext = { ...initialWorkflowContext(), ...state.context };

      return machine.resolveState({
        value: resting ? value : WORKFLOW_READY_FOR_NEW_MESSAGE,
        context: resting
          ? context
          : {
              ...context,
              aiResponse: null,
              toolCallResults: [],
              currentToolCall: undefined,
              activity: [],
              lastError: {
                code: 'TURN_INTERRUPTED',
                message: 'The turn was interrupted and could not be resumed',
                step: typeof value === 'string' ? value : JSON.stringify(value),
                at: new Date().toISOString(),
              },
            },
      });
    },
  };
}
