import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ProductionAdaptersModule } from './adapters/production-adapters.module';
import { AppModule } from './app.module';
import { loadEnvironment } from './config/environment';
import { configureApp } from './configure-app';

const environment = loadEnvironment();

const app = await NestFactory.create(
  AppModule.register({ environment, adapters: ProductionAdaptersModule.register(environment) }),
  {
    logger: new ConsoleLogger({ prefix: 'ApexBrain', json: environment.LOG_FORMAT === 'json' }),
  },
);

configureApp(app, environment);

await app.listen(environment.PORT, environment.HOST);

new Logger('Bootstrap').log(
  `Apex Brain écoute sur ${await app.getUrl()}${environment.SWAGGER_ENABLED ? ' (documentation : /docs)' : ''}`,
);
