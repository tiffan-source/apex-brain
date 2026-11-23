import { Logger } from '@nestjs/common';
import type { BusLogger } from '@org/event-bus';

const logger = new Logger('EventBus');

/** Les pannes d'abonnés et de connexion du bus, dans les journaux de Nest. */
export const eventBusLogger: BusLogger = {
  error: (message, error) =>
    error === undefined
      ? logger.error(message)
      : logger.error(message, error instanceof Error ? error.stack : String(error)),
  info: (message) => logger.log(message),
};
