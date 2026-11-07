import { IdGenerator, Result, runWithResult } from '@org/chore';
import { Objective } from '../models/objective';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { FailToSaveObjectiveError } from '../errors/fail-to-save-objective.error';
import { ObjectiveCommandOutput, toObjectiveCommandOutput } from '../mappers/command-output.mapper';

export interface CreateObjectiveInput {
  title: string;
  description?: string;
  why?: string;
  dueDate?: Date;
  ownerId: string;
}

export type CreateObjectiveOutput = ObjectiveCommandOutput;

/** Définir un nouvel objectif principal. */
export class CreateObjectiveUsecase {
  constructor(
    private readonly repository: ObjectiveRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: CreateObjectiveInput): Promise<Result<CreateObjectiveOutput>> {
    return runWithResult<CreateObjectiveOutput>(
      async () => {
        const id = this.idGenerator.generateId();
        const newObjective = new Objective(id, input.title);

        if (input.description) {
          newObjective.setDescription(input.description);
        }

        if (input.why) {
          newObjective.setWhy(input.why);
        }

        if (input.dueDate) {
          newObjective.setDueDate(input.dueDate);
        }

        const saved = await this.repository.save(newObjective, input.ownerId);

        if (!saved) {
          throw new FailToSaveObjectiveError(id);
        }

        return toObjectiveCommandOutput(newObjective);
      },
      [FailToSaveObjectiveError],
      'Failed to create objective',
    );
  }
}
