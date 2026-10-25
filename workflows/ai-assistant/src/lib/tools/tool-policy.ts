import {
  IToolExecutionPolicy,
  IToolRegistry,
  ToolCall,
  ToolExecutionContext,
  ToolExecutionDecision,
} from '../workflow/actors.protocols';

export class ToolPolicy implements IToolExecutionPolicy {
  constructor(private readonly registry: IToolRegistry) {}

  async decide(
    tool: ToolCall,
    _context: ToolExecutionContext,
    _input: unknown,
  ): Promise<ToolExecutionDecision> {
    try {
      // `get` lève si l'outil n'est pas enregistré (cf. catch ci-dessous).
      const registered = this.registry.get(tool.name);

      // Les outils d'écriture requièrent l'accord explicite de l'utilisateur
      // avant exécution ; la machine bascule alors en WaitingForUserPermission.
      if (registered.requiresPermission) {
        return {
          type: 'ask-user',
          reason: `L'outil ${tool.name} modifie tes données et requiert ta confirmation.`,
        };
      }

      return { type: 'execute' };
    } catch {
      return { type: 'deny', reason: `Tool ${tool.name} is not registered` };
    }
  }
}
