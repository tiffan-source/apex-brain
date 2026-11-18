import { AkariUsage } from '../models/akari-usage';
import { AkariUsageRepository } from '../protocols/akari-usage.repository';

/**
 * Le journal d'usage en mémoire (perdu au redémarrage) : pour le développement local, les tests, et
 * la production tant que Firestore ne le porte pas (issue #13).
 */
export class InMemoryAkariUsageRepository extends AkariUsageRepository {
  readonly usages = new Map<string, AkariUsage>();

  async countSince(ownerId: string, since: Date | null): Promise<number> {
    return [...this.usages.values()].filter(
      (usage) => usage.ownerId === ownerId && (since === null || usage.at >= since),
    ).length;
  }

  async record(id: string, usage: AkariUsage): Promise<void> {
    if (!this.usages.has(id)) this.usages.set(id, { ...usage });
  }
}
