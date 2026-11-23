import type { WorkflowDefinition, WorkflowLogger } from '@org/workflow-runtime';
import { WORKFLOW_READY_FOR_NEW_MESSAGE, WorkflowContext, WorkflowStateValue } from '../model/workflow.model';
import { ConversationMachine, getMachine, initialWorkflowContext, MachineDependencies } from './machine';
import { isRestingValue } from './workflow-state.view';

/** Le nom du workflow de l'assistant, pour le runtime. */
export const AI_ASSISTANT_WORKFLOW = 'ai-assistant';

/**
 * Le workflow de l'assistant, tel que le runtime l'héberge : la machine munie de ses ports, et ce que le
 * runtime ne sait pas seul (à qui appartient un état stocké, comment relire un document d'Apex, quand une
 * instance est au repos).
 */
export function aiAssistantWorkflow(
  deps: MachineDependencies,
  logger: WorkflowLogger = consoleLogger,
): WorkflowDefinition<ConversationMachine> {
  const machine = getMachine({ ...deps, onTurnSucceeded: reportTurnSucceeded(deps.onTurnSucceeded, logger) });

  return {
    name: AI_ASSISTANT_WORKFLOW,
    machine,
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

const consoleLogger: WorkflowLogger = {
  error: (message, error) => console.error(message, error),
  warn: (message) => console.warn(message),
};

/**
 * Un abonné en panne ne fait pas échouer le tour : la réponse d'Akari est déjà écrite et la personne
 * l'a. La panne est journalisée.
 */
function reportTurnSucceeded(
  onTurnSucceeded: MachineDependencies['onTurnSucceeded'],
  logger: WorkflowLogger,
): MachineDependencies['onTurnSucceeded'] {
  if (!onTurnSucceeded) return undefined;
  return async (turn) => {
    try {
      await onTurnSucceeded(turn);
    } catch (error) {
      logger.error(`Workflow ${turn.objectiveId}: the succeeded turn could not be reported`, error);
    }
  };
}
