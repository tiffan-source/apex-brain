import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { Environment } from './environment';
import { APP_ENVIRONMENT } from './environment';

@Module({})
export class ConfigurationModule {
  /** La configuration validée, injectable partout par `@Inject(APP_ENVIRONMENT)`. */
  static register(environment: Environment): DynamicModule {
    return {
      module: ConfigurationModule,
      global: true,
      providers: [{ provide: APP_ENVIRONMENT, useValue: environment }],
      exports: [APP_ENVIRONMENT],
    };
  }
}
