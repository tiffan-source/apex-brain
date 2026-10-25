import { IToolRegistry, Tool } from '../workflow/actors.protocols';

export class ToolRegistry implements IToolRegistry {
  constructor(private readonly tools: Tool[]) {}

  get(name: string): Tool {
    const tool = this.tools.find((candidate) => candidate.name === name);

    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }

    return tool;
  }

  getAll(): Tool[] {
    return this.tools;
  }
}
