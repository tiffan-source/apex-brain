import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserOutput } from '@org/auth';
import { CreateNewUserUseCase, LogUserInUseCase, LogUserOutUseCase, RefreshSessionUseCase } from '@org/auth';
import { openApiErrorSchema, openApiSchema } from '../http/openapi';
import { unwrap } from '../http/result';
import { RateLimit } from '../rate-limit/rate-limit';
import { AccessToken, CurrentUser, Public } from './auth.decorators';
import type { Credentials, RefreshBody } from './auth.schemas';
import {
  credentialsSchema,
  refreshSchema,
  registeredResponseSchema,
  signedInResponseSchema,
  userResponseSchema,
} from './auth.schemas';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(CreateNewUserUseCase) private readonly createNewUser: CreateNewUserUseCase,
    @Inject(LogUserInUseCase) private readonly logUserIn: LogUserInUseCase,
    @Inject(RefreshSessionUseCase) private readonly refreshSession: RefreshSessionUseCase,
    @Inject(LogUserOutUseCase) private readonly logUserOut: LogUserOutUseCase,
  ) {}

  /** CreateNewUserUseCase */
  @Public()
  @RateLimit('auth')
  @Post('register')
  @ApiResponse({ status: 201, description: 'Compte créé', schema: openApiSchema(registeredResponseSchema) })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR, WEAK_PASSWORD, INVALID_EMAIL',
    schema: openApiErrorSchema(),
  })
  @ApiResponse({ status: 409, description: 'USER_ALREADY_EXIST', schema: openApiErrorSchema() })
  async register(@Body({ schema: credentialsSchema }) body: Credentials) {
    return unwrap(await this.createNewUser.execute(body));
  }

  /** LogUserInUseCase */
  @Public()
  @RateLimit('auth')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ status: 200, description: 'Session ouverte', schema: openApiSchema(signedInResponseSchema) })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS', schema: openApiErrorSchema() })
  @ApiResponse({ status: 403, description: 'EMAIL_NOT_CONFIRMED', schema: openApiErrorSchema() })
  async login(@Body({ schema: credentialsSchema }) body: Credentials) {
    return unwrap(await this.logUserIn.execute(body));
  }

  /** RefreshSessionUseCase */
  @Public()
  @RateLimit('auth')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Nouvelle session',
    schema: openApiSchema(signedInResponseSchema),
  })
  @ApiResponse({ status: 401, description: 'INVALID_SESSION', schema: openApiErrorSchema() })
  async refresh(@Body({ schema: refreshSchema }) body: RefreshBody) {
    return unwrap(await this.refreshSession.execute(body));
  }

  /** LogUserOutUseCase */
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: 204, description: 'Session fermée' })
  async logout(@AccessToken() accessToken: string): Promise<void> {
    unwrap(await this.logUserOut.execute({ accessToken }));
  }

  /** GetCurrentUserUseCase (déjà exécuté par la garde pour cette requête) */
  @ApiBearerAuth()
  @Get('me')
  @ApiResponse({
    status: 200,
    description: 'La personne connectée',
    schema: openApiSchema(userResponseSchema),
  })
  @ApiResponse({ status: 401, description: 'UNAUTHENTICATED', schema: openApiErrorSchema() })
  me(@CurrentUser() user: AuthenticatedUserOutput): AuthenticatedUserOutput {
    return user;
  }
}
