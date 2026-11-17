import { allowanceFor } from './allowance';
import { UsagePolicy } from './usage-policy';

const SEND = 'assistant.send-message';

const policy = (overrides: Partial<UsagePolicy> & Pick<UsagePolicy, 'role'>): UsagePolicy => ({
  action: SEND,
  quota: null,
  period: 'lifetime',
  ...overrides,
});

/** Les politiques livrées par la migration : standard 3, premium et admin sans limite. */
const launch: UsagePolicy[] = [
  policy({ role: 'standard', quota: 3 }),
  policy({ role: 'premium' }),
  policy({ role: 'admin' }),
];

describe('allowanceFor', () => {
  it('laisse libre une action qu’aucune politique ne nomme', () => {
    expect(allowanceFor(['standard'], 'assistant.select-model', launch)).toEqual({ access: 'free' });
    expect(allowanceFor(['standard'], SEND, [])).toEqual({ access: 'free' });
  });

  it('limite le compte standard à son quota, sur le compteur de son rôle', () => {
    expect(allowanceFor(['standard'], SEND, launch)).toEqual({
      access: 'limited',
      role: 'standard',
      quota: 3,
      period: 'lifetime',
    });
  });

  it('ne limite ni premium ni admin', () => {
    expect(allowanceFor(['premium'], SEND, launch)).toEqual({ access: 'unlimited' });
    expect(allowanceFor(['admin'], SEND, launch)).toEqual({ access: 'unlimited' });
  });

  it("refuse une action gouvernée à qui n'a aucun des rôles nommés : pas de passe-droit, même admin", () => {
    const premiumOnly = [policy({ action: 'assistant.select-model', role: 'premium' })];

    expect(allowanceFor(['standard'], 'assistant.select-model', premiumOnly)).toEqual({ access: 'denied' });
    expect(allowanceFor(['admin'], 'assistant.select-model', premiumOnly)).toEqual({ access: 'denied' });
    expect(allowanceFor(['premium'], 'assistant.select-model', premiumOnly)).toEqual({ access: 'unlimited' });
  });

  it('donne le droit le plus généreux des rôles de la personne', () => {
    expect(allowanceFor(['standard', 'premium'], SEND, launch)).toEqual({ access: 'unlimited' });

    const twoLimits = [policy({ role: 'standard', quota: 3 }), policy({ role: 'premium', quota: 10 })];
    expect(allowanceFor(['premium', 'standard'], SEND, twoLimits)).toMatchObject({
      role: 'premium',
      quota: 10,
    });
  });

  it('à quota égal, préfère la période qui repart le plus souvent, puis le nom du rôle', () => {
    const sameQuota = [
      policy({ role: 'standard', quota: 5, period: 'lifetime' }),
      policy({ role: 'premium', quota: 5, period: 'day' }),
      policy({ role: 'admin', quota: 5, period: 'month' }),
    ];
    expect(allowanceFor(['standard', 'premium', 'admin'], SEND, sameQuota)).toMatchObject({
      role: 'premium',
      period: 'day',
    });

    const identical = [policy({ role: 'standard', quota: 5 }), policy({ role: 'premium', quota: 5 })];
    expect(allowanceFor(['standard', 'premium'], SEND, identical)).toMatchObject({ role: 'premium' });
    expect(allowanceFor(['premium', 'standard'], SEND, [...identical].reverse())).toMatchObject({
      role: 'premium',
    });
  });

  it('traite un quota de 0 comme une limite déjà atteinte, pas comme une absence de règle', () => {
    expect(allowanceFor(['standard'], SEND, [policy({ role: 'standard', quota: 0 })])).toEqual({
      access: 'limited',
      role: 'standard',
      quota: 0,
      period: 'lifetime',
    });
  });

  it("ne lit que les politiques de l'action demandée", () => {
    const mixed = [policy({ action: 'autre.action', role: 'standard', quota: 1 }), ...launch];

    expect(allowanceFor(['standard'], SEND, mixed)).toMatchObject({ quota: 3 });
    expect(allowanceFor(['premium'], 'autre.action', mixed)).toEqual({ access: 'denied' });
  });
});
