import type { DocumentStore } from '../document-store';

/** Une Firestore en mémoire qui, comme la vraie, refuse les tableaux imbriqués. */
export class FakeFirestore implements DocumentStore {
  readonly documents = new Map<string, Record<string, unknown>>();

  collection(name: string) {
    return {
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>) => {
          if (containsNestedArray(data)) throw new Error('Nested arrays are not supported');
          this.documents.set(`${name}/${id}`, structuredClone(data));
        },
        get: async () => {
          const data = this.documents.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
        },
        delete: async () => this.documents.delete(`${name}/${id}`),
      }),
    };
  }
}

function containsNestedArray(value: unknown, insideArray = false): boolean {
  if (Array.isArray(value)) return insideArray || value.some((item) => containsNestedArray(item, true));
  if (value && typeof value === 'object')
    return Object.values(value).some((item) => containsNestedArray(item, false));
  return false;
}
