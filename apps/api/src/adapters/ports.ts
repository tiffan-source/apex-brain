import { InteractiveAIProvider } from '@org/ai';
import { AuthProvider } from '@org/auth';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { IdGenerator } from '@org/chore';
import { GetAllObjectiveAndTaskQuery, ObjectiveRepository, TaskRepository } from '@org/objective';
import { IWorkflowStateRepository } from '@org/ai-assistant';

/**
 * Les ports que les modules métier attendent de l'infrastructure. Un module d'adaptateurs (Supabase,
 * Gemini, Firestore en production ; doublures en mémoire dans les tests) fournit chacun d'eux :
 * c'est le seul endroit où les abstractions du domaine rencontrent une implémentation.
 */
export const PORTS = [
  IdGenerator,
  ObjectiveRepository,
  TaskRepository,
  GetAllObjectiveAndTaskQuery,
  AuthProvider,
  GetConversationsQuery,
  AddMessageCommand,
  InteractiveAIProvider,
  IWorkflowStateRepository,
] as const;
