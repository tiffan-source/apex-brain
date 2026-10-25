import { ObjectiveInternalService } from '@org/objective';
import { z } from 'zod';
import { Tool, ToolExecutionContext } from '../workflow/actors.protocols';

const createTaskInput = z.object({
  objectiveId: z
    .string()
    .describe(
      "Identifiant de l'objectif ou du sous-objectif auquel rattacher la tâche. Utilise getObjectiveTree pour connaître les identifiants.",
    ),
  title: z.string().min(1).describe('Titre de la tâche à créer.'),
  importance: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("Importance de la tâche, de 1 à 5 (>= 3 = importante au sens de la matrice d'Eisenhower)."),
  urgency: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("Urgence de la tâche, de 1 à 5 (>= 3 = urgente au sens de la matrice d'Eisenhower)."),
});

type CreateTaskOutput =
  | { success: true; id: string; title: string; importance: number; urgency: number }
  | { success: false; error: string };

export class CreateTaskTool implements Tool<typeof createTaskInput, CreateTaskOutput> {
  readonly name = 'createTask';

  readonly description = 'Créer une nouvelle tâche rattachée à un objectif (ou sous-objectif) existant.';

  readonly inputSchema = createTaskInput;

  readonly requiresPermission = true;

  constructor(private readonly objectiveService: ObjectiveInternalService) {}

  async execute(
    context: ToolExecutionContext,
    input: z.infer<typeof createTaskInput>,
  ): Promise<CreateTaskOutput> {
    const created = await this.objectiveService.addTask(
      input.objectiveId,
      { title: input.title, importance: input.importance, urgency: input.urgency },
      context.userId,
    );

    if (!created) {
      return {
        success: false,
        error: "Impossible de créer la tâche (objectif introuvable ou échec d'enregistrement).",
      };
    }

    return {
      success: true,
      id: created.id,
      title: created.title,
      importance: created.importance,
      urgency: created.urgency,
    };
  }
}
