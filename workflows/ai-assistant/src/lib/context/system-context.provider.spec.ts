import { AkariSystemContextProvider } from './system-context.provider';

describe('AkariSystemContextProvider', () => {
  const context = new AkariSystemContextProvider().getContext({ objectiveId: 'o1', userId: 'alice' });

  it("nomme l'objectif de la conversation", () => {
    expect(context).toContain('« o1 »');
  });

  it("dit à Akari qu'étapes et pas n'ont aucun ordre", () => {
    expect(context).toContain('indépendantes les unes des autres');
    expect(context).toContain('aucun ordre');
    expect(context).toContain('Ne numérote jamais');
    expect(context).toContain('prochain pas');
  });

  it('ramène « par quoi commencer » à ce que disent les pas', () => {
    expect(context).toContain("l'importance et l'urgence des pas");
  });
});
