import { ObjectiveInternalService } from '@org/objective';
import { z } from 'zod';
import { Tool, ToolExecutionContext } from '../workflow/actors.protocols';

const createSubObjectiveInput = z.object({
  parentObjectiveId: z
    .string()
    .describe(
      "Identifiant de l'objectif ou du sous-objectif parent sous lequel créer le sous-objectif. Utilise getObjectiveTree pour connaître les identifiants.",
    ),
  title: z.string().min(1).describe('Titre du sous-objectif à créer.'),
});

type CreateSubObjectiveOutput =
  { success: true; id: string; title: string } | { success: false; error: string };

export class CreateSubObjectiveTool implements Tool<
  typeof createSubObjectiveInput,
  CreateSubObjectiveOutput
> {
  readonly name = 'createSubObjective';

  readonly description = 'Créer un nouveau sous-objectif sous un objectif (ou sous-objectif) existant.';

  readonly inputSchema = createSubObjectiveInput;

  readonly requiresPermission = true;

  constructor(private readonly objectiveService: ObjectiveInternalService) {}

  async execute(
    context: ToolExecutionContext,
    input: z.infer<typeof createSubObjectiveInput>,
  ): Promise<CreateSubObjectiveOutput> {
    const created = await this.objectiveService.createSubObjective(
      input.parentObjectiveId,
      input.title,
      context.userId,
    );

    if (!created) {
      return {
        success: false,
        error:
          "Impossible de créer le sous-objectif (objectif parent introuvable ou échec d'enregistrement).",
      };
    }

    return { success: true, id: created.id, title: created.title };
  }
}
