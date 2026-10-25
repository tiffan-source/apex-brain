import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AssistantModule } from './assistant/assistant.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { ConfigurationModule } from './config/configuration.module';
import type { Environment } from './config/environment';
import { APP_ENVIRONMENT } from './config/environment';
import { ConversationModule } from './conversation/conversation.module';
import { HealthController } from './health/health.controller';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { createValidationPipe } from './http/validation.pipe';
import { ObjectivesModule } from './objectives/objectives.module';
import { throttlerOptions } from './rate-limit/rate-limit';

export type AppModuleOptions = {
  environment: Environment;
  /**
   * Le module qui fournit les ports (`adapters/ports.ts`) : Supabase, Gemini et Firestore en
   * production (`ProductionAdaptersModule`), des doublures en mémoire dans les tests.
   */
  adapters: DynamicModule;
};

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigurationModule.register(options.environment),
        options.adapters,
        ThrottlerModule.forRootAsync({
          inject: [APP_ENVIRONMENT],
          useFactory: (environment: Environment) => throttlerOptions(environment),
        }),
        AuthModule,
        ObjectivesModule,
        ConversationModule,
        AssistantModule,
      ],
      controllers: [HealthController],
      providers: [
        // L'ordre compte : la garde d'authentification identifie la personne, puis la limitation de
        // débit compte ses requêtes (par personne plutôt que par adresse IP).
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    };
  }
}
