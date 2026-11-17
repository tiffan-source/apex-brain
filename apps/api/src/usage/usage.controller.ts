import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserOutput } from '@org/auth';
import { UsageGate } from '@org/usage';
import { CurrentUser } from '../auth/auth.decorators';
import { openApiSchema } from '../http/openapi';
import { usageResponseSchema } from './usage.schemas';

@ApiTags('usage')
@ApiBearerAuth()
@Controller('usage')
export class UsageController {
  constructor(@Inject(UsageGate) private readonly gate: UsageGate) {}

  /**
   * Ce que la personne peut encore faire de chaque action gouvernée : sans limite, refusée, ou ce qu'il lui reste
   * sur la période. Le serveur reste seul juge : un client s'en sert pour l'affichage (« 2 messages restants »).
   */
  @Get()
  @ApiOperation({ operationId: 'getMyUsage' })
  @ApiResponse({ status: 200, schema: openApiSchema(usageResponseSchema) })
  async usage(@CurrentUser() user: AuthenticatedUserOutput) {
    return { actions: await this.gate.usageOf({ id: user.id, roles: user.roles }) };
  }
}
