/**
 * Les tests d'intégration tournent contre un vrai Redis (local : `redis-server`, ou le service de la CI),
 * seulement quand `REDIS_INTEGRATION=1`. L'adresse vient de `REDIS_URL`.
 */
export const integrationEnabled = process.env['REDIS_INTEGRATION'] === '1';

export function integrationRedisUrl(): string {
  return process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
}

/** Un canal propre à un test : deux tests (ou deux CI) sur le même Redis ne se voient pas. */
export const testChannel = () => `apex-brain:test:${globalThis.crypto.randomUUID()}`;
