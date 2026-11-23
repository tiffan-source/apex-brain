import type { AnyStateMachine, ContextFrom, SnapshotFrom } from 'xstate';
import type { StoredWorkflowState } from './protocols/workflow-state-store';

/**
 * Ce qu'un workflow confie au runtime : son nom, sa machine (déjà munie de ses ports), et ce que le
 * runtime ne peut pas deviner seul. Le runtime ne sait rien d'autre du workflow.
 */
export type WorkflowDefinition<TMachine extends AnyStateMachine> = {
  /** Le nom du workflow (`ai-assistant`). */
  name: string;
  machine: TMachine;
  /** À qui appartient un état stocké, s'il le dit : le runtime refuse de le rendre à quelqu'un d'autre. */
  ownerOf?: (state: StoredWorkflowState<ContextFrom<TMachine>>) => string | undefined;
  /**
   * Rebâtir un snapshot quand l'état stocké n'a pas de snapshot XState restaurable (un ancien format, un
   * snapshot qui ne se relit plus). Sans lui, l'instance repart de l'état initial.
   */
  recover?: (state: StoredWorkflowState<ContextFrom<TMachine>>) => SnapshotFrom<TMachine>;
  /**
   * Une instance au repos peut quitter la mémoire : elle sera restaurée au besoin. Par défaut, au repos
   * veut dire sans étape en cours (aucun acteur invoqué).
   */
  isResting?: (snapshot: SnapshotFrom<TMachine>) => boolean;
  /**
   * Les faits annoncés (`emit`) qui peuvent aller au client de la personne. Les autres restent sur le
   * serveur (`audience: 'internal'`).
   */
  publicEvents?: readonly string[];
  /**
   * La vue publique de l'état, celle que lisent les clients. Donnée, le runtime publie après chaque
   * sauvegarde un événement public `<nom>.state.changed` qui la porte.
   */
  publicState?: (snapshot: SnapshotFrom<TMachine>, key: string) => unknown;
};
