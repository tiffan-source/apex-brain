import { usageWindow } from './usage-window';

describe('usageWindow', () => {
  const at = (iso: string) => new Date(iso);

  it('ne repart jamais pour lifetime', () => {
    expect(usageWindow('lifetime', at('2026-11-16T14:00:00Z'))).toEqual({ key: 'lifetime', resetsAt: null });
  });

  it('compte par jour UTC et repart à minuit UTC', () => {
    expect(usageWindow('day', at('2026-11-16T23:59:59.999Z'))).toEqual({
      key: '2026-11-16',
      resetsAt: at('2026-11-17T00:00:00.000Z'),
    });
    expect(usageWindow('day', at('2026-11-17T00:00:00.000Z')).key).toBe('2026-11-17');
  });

  it('compte par mois UTC et repart le premier du mois suivant, décembre compris', () => {
    expect(usageWindow('month', at('2026-11-30T23:00:00Z'))).toEqual({
      key: '2026-11',
      resetsAt: at('2026-12-01T00:00:00.000Z'),
    });
    expect(usageWindow('month', at('2026-12-31T23:59:59Z'))).toEqual({
      key: '2026-12',
      resetsAt: at('2027-01-01T00:00:00.000Z'),
    });
  });

  it('passe le dernier jour de février et le 31 décembre sans sauter de jour', () => {
    expect(usageWindow('day', at('2028-02-28T12:00:00Z')).resetsAt).toEqual(at('2028-02-29T00:00:00Z'));
    expect(usageWindow('day', at('2026-12-31T12:00:00Z')).resetsAt).toEqual(at('2027-01-01T00:00:00Z'));
  });
});
