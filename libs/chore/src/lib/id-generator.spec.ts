import { UuidIdGenerator } from './id-generator';

describe('UuidIdGenerator', () => {
  it('produit des UUID v4 distincts', () => {
    const generator = new UuidIdGenerator();
    const ids = new Set(Array.from({ length: 100 }, () => generator.generateId()));

    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
