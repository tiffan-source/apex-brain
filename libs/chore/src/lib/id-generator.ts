export abstract class IdGenerator {
  abstract generateId(): string;
}

/**
 * Identifiants aléatoires (UUID v4) tirés du générateur cryptographique de la plateforme.
 * Remplace le `SimpleIdGenerator` d'Apex, fondé sur `Math.random()`.
 */
export class UuidIdGenerator extends IdGenerator {
  generateId(): string {
    return globalThis.crypto.randomUUID();
  }
}
