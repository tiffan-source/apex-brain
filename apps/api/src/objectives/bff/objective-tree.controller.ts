import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserOutput } from '@org/auth';
import { GetObjectiveTreeQuery } from '@org/objective/bff';
import { CurrentUser } from '../../auth/auth.decorators';
import { openApiSchema } from '../../http/openapi';
import { objectiveTreeResponseSchema } from './objective-tree.schemas';

/**
 * BFF : les lectures taillées pour les clients d'Apex (web et mobile). Elles passent directement par
 * leur port, implémenté par l'infrastructure, sans cas d'usage (docs/adr/0006-commandes-et-bff.md).
 */
@ApiTags('bff')
@ApiBearerAuth()
@Controller({ path: 'bff', version: '2' })
export class ObjectiveTreeController {
  constructor(@Inject(GetObjectiveTreeQuery) private readonly getObjectiveTree: GetObjectiveTreeQuery) {}

  @Get('objective-tree')
  @ApiOperation({
    operationId: 'getObjectiveTree',
    summary: 'Tous les objectifs de la personne en arbre : étapes emboîtées, pas sous qui les porte',
    description:
      "`done` d'un objectif ou d'une étape est rendu tel qu'il est en base : rien ne le tient à jour pour " +
      "l'instant (`false` par défaut). Celui des pas est juste.",
  })
  @ApiResponse({ status: 200, schema: openApiSchema(objectiveTreeResponseSchema) })
  tree(@CurrentUser() user: AuthenticatedUserOutput) {
    return this.getObjectiveTree.execute({ ownerId: user.id });
  }
}
