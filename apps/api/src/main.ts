import { Logger } from '@nestjs/common';
import { loadEnvironment } from './config/environment';
import { createApp } from './create-app';

const environment = loadEnvironment();
const app = await createApp(environment);

await app.listen(environment.PORT, environment.HOST);

new Logger('Bootstrap').log(
  `Apex Brain écoute sur ${await app.getUrl()}${environment.SWAGGER_ENABLED ? ' (documentation : /docs)' : ''}`,
);
