import { InteractiveAIProvider } from '@org/ai';
import { AuthProvider } from '@org/auth';
import { AddMessageCommand, GetConversationsQuery } from '@org/chat';
import { IdGenerator } from '@org/chore';
import { ObjectiveRepository, TaskRepository } from '@org/objective';
import { GetObjectiveTreeQuery } from '@org/objective/bff';
import { IWorkflowStateRepository } from '@org/ai-assistant';
import { BackgroundWork } from '../platform/background-work';

/**
 * Les ports que les modules métier attendent de l'infrastructure. Un module d'adaptateurs (Supabase,
 * Gemini, Firestore en production ; doublures en mémoire dans les tests) fournit chacun d'eux :
 * c'est le seul endroit où les abstractions du domaine rencontrent une implémentation. S'y ajoute
 * ce que l'application attend de son hébergeur (`BackgroundWork`).
 */
export const PORTS = [
  IdGenerator,
  ObjectiveRepository,
  TaskRepository,
  GetObjectiveTreeQuery,
  AuthProvider,
  GetConversationsQuery,
  AddMessageCommand,
  InteractiveAIProvider,
  IWorkflowStateRepository,
  BackgroundWork,
] as const;
