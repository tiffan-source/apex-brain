import { GrantedReservation } from './usage-gate';

/** L'issue d'une action acceptée, connue après coup. */
export type HeldOutcome = 'succeeded' | 'failed';

type Held = { reservation: GrantedReservation; heldAt: number };

export type HeldReservationsOptions = {
  /** Au-delà, une réservation tenue est oubliée et son unité reste consommée. Défaut : 24 heures. */
  maxAgeMs?: number;
  /** Horloge, remplaçable dans les tests. */
  now?: () => number;
};

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Les unités réservées pour une action dont l'issue n'est connue qu'après coup : l'action est acceptée, puis se
 * joue. Elles sont tenues sous une clé jusqu'à ce que l'issue soit connue ; une issue en panne rend l'unité.
 *
 * En mémoire : seule l'instance qui a tenu une réservation peut la régler. Une issue connue ailleurs (après un
 * redémarrage, sur une autre instance) ne la retrouve pas, et l'unité reste consommée : jamais d'action offerte,
 * au pire une unité perdue. Une réservation tenue plus de `maxAgeMs` est oubliée de même.
 */
export class HeldReservations {
  private readonly held = new Map<string, Held[]>();
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(options: HeldReservationsOptions = {}) {
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
  }

  /** Tenir une réservation sous cette clé, après celles qui y attendent déjà. */
  hold(key: string, reservation: GrantedReservation): void {
    this.forgetExpired();
    const queue = this.held.get(key) ?? [];
    queue.push({ reservation, heldAt: this.now() });
    this.held.set(key, queue);
  }

  /** Ne plus tenir cette réservation (l'action a échoué avant d'être acceptée) ; sans effet si elle n'y est plus. */
  drop(key: string, reservation: GrantedReservation): void {
    const queue = this.held.get(key);
    if (!queue) return;

    const index = queue.findIndex((entry) => entry.reservation === reservation);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.held.delete(key);
  }

  /**
   * L'issue de la plus ancienne réservation de cette clé est connue : réussie, l'unité reste consommée ; en
   * panne, elle est rendue. Sans effet quand rien n'est tenu sous cette clé (une action qui n'a rien compté,
   * une réservation tenue par une autre instance).
   */
  async settle(key: string, outcome: HeldOutcome): Promise<void> {
    const queue = this.held.get(key);
    const oldest = queue?.shift();
    if (queue?.length === 0) this.held.delete(key);

    if (oldest && outcome === 'failed') {
      await oldest.reservation.release();
    }
  }

  /** Le nombre de réservations tenues. */
  get size(): number {
    let size = 0;
    for (const queue of this.held.values()) size += queue.length;
    return size;
  }

  private forgetExpired(): void {
    const oldest = this.now() - this.maxAgeMs;

    for (const [key, queue] of this.held) {
      const kept = queue.filter((entry) => entry.heldAt > oldest);
      if (kept.length === 0) this.held.delete(key);
      else if (kept.length < queue.length) this.held.set(key, kept);
    }
  }
}

/** La clé d'une réservation tenue : l'action, la personne, et ce qui désigne l'opération en cours. */
export function heldReservationKey(action: string, ownerId: string, subject: string): string {
  return JSON.stringify([action, ownerId, subject]);
}
