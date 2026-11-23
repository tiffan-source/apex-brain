import { Clock } from '../protocols/clock';

/** L'heure du serveur. */
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
