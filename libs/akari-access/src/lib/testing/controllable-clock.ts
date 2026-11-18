import { Clock } from '../protocols/clock';

/** Une horloge que le test règle. */
export class ControllableClock extends Clock {
  constructor(private current = new Date('2027-01-15T10:00:00.000Z')) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date | string): void {
    this.current = new Date(at);
  }
}
