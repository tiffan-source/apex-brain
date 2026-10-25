import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators';
import { openApiSchema } from '../http/openapi';

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
});

/** Le serveur répond (sonde de vie pour l'hébergeur). */
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Public()
  @Get()
  @ApiResponse({ status: 200, schema: openApiSchema(healthResponseSchema) })
  health() {
    return { status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) };
  }
}
