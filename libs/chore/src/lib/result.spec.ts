import { CoreError } from './core.error';
import { failure, runWithResult, success, UNKNOWN_ERROR } from './result';

class ExpectedError extends CoreError {
  constructor() {
    super('EXPECTED', 'expected failure', { reason: 'test' });
  }
}

class OtherDomainError extends CoreError {
  constructor() {
    super('OTHER', 'not listed');
  }
}

describe('runWithResult', () => {
  it("rend les données de l'action", async () => {
    await expect(runWithResult(async () => 42, [], 'fallback')).resolves.toEqual(success(42));
  });

  it('transforme une erreur attendue en échec structuré, avec ses métadonnées', async () => {
    const result = await runWithResult(
      async () => {
        throw new ExpectedError();
      },
      [ExpectedError],
      'fallback',
    );

    expect(result).toEqual(failure('EXPECTED', 'expected failure', { reason: 'test' }));
  });

  it('ramène une erreur métier non listée à UNKNOWN_ERROR', async () => {
    const result = await runWithResult(
      async () => {
        throw new OtherDomainError();
      },
      [ExpectedError],
      'fallback',
    );

    expect(result).toEqual(failure(UNKNOWN_ERROR, 'not listed'));
  });

  it("utilise le message de repli quand ce qui est levé n'est pas une Error", async () => {
    const result = await runWithResult(
      async () => {
        throw 'boom';
      },
      [ExpectedError],
      'fallback',
    );

    expect(result).toEqual(failure(UNKNOWN_ERROR, 'fallback'));
  });
});
