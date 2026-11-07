import { IdGenerator, Result, runWithResult } from '@org/chore';
import { ObjectiveRepository } from '../protocols/objective.repository';
import { Objective } from '../models/objective';
import { ObjectiveNotFoundError } from '../errors/objective-not-found.error';
import { FailToSaveObjectiveError } from '../errors/fail-to-save-objective.error';
import { ObjectiveCommandOutput, toObjectiveCommandOutput } from '../mappers/command-output.mapper';

export interface AddSubObjectiveInput {
  parentObjectiveId: string;
  title: string;
  ownerId: string;
}

export type AddSubObjectiveOutput = ObjectiveCommandOutput;

/** Ajouter une étape sous un objectif ou une étape. */
export class AddSubObjectiveUsecase {
  constructor(
    private readonly objectiveRepository: ObjectiveRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: AddSubObjectiveInput): Promise<Result<AddSubObjectiveOutput>> {
    return runWithResult<AddSubObjectiveOutput>(
      async () => {
        const parentObjective = await this.objectiveRepository.findById(
          input.parentObjectiveId,
          input.ownerId,
        );

        if (!parentObjective) {
          throw new ObjectiveNotFoundError(input.parentObjectiveId);
        }

        const subObjective = new Objective(this.idGenerator.generateId(), input.title);
        parentObjective.addSubObjective(subObjective);

        const saved = await this.objectiveRepository.save(parentObjective, input.ownerId);

        if (!saved) {
          throw new FailToSaveObjectiveError(parentObjective.id);
        }

        return toObjectiveCommandOutput(subObjective);
      },
      [ObjectiveNotFoundError, FailToSaveObjectiveError],
      'Failed to add sub-objective',
    );
  }
}
