import { IdGenerator } from '../id-generator';

/** Des identifiants prévisibles pour les tests : `id-1`, `id-2`… */
export class SequentialIdGenerator extends IdGenerator {
  private next = 0;

  constructor(private readonly prefix = 'id') {
    super();
  }

  generateId(): string {
    this.next += 1;
    return `${this.prefix}-${this.next}`;
  }
}
