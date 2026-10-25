import { ObjectiveInternalService, ObjectiveTreeOutput } from '@org/objective';
import { z } from 'zod';
import { Tool, ToolExecutionContext } from '../workflow/actors.protocols';

const getObjectiveTreeInput = z.object({
  id: z.string().describe("Identifiant de l'objectif (ou de l'étape) dont on veut l'arbre."),
});

export class GetObjectiveTreeTool implements Tool<typeof getObjectiveTreeInput, ObjectiveTreeOutput | null> {
  readonly name = 'getObjectiveTree';

  readonly description =
    "Lire l'arbre complet sous un objectif ou une étape : ses étapes, ses pas, leur importance, leur urgence et ce qui est fait.";

  readonly inputSchema = getObjectiveTreeInput;

  constructor(private readonly objectiveService: ObjectiveInternalService) {}

  async execute(
    context: ToolExecutionContext,
    input: z.infer<typeof getObjectiveTreeInput>,
  ): Promise<ObjectiveTreeOutput | null> {
    return this.objectiveService.getObjectiveTree(input.id, context.userId);
  }
}
