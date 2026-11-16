/** Le strict nécessaire de Firestore, remplaçable dans les tests. */
export interface DocumentStore {
  collection(name: string): {
    doc(id: string): {
      set(data: Record<string, unknown>): Promise<unknown>;
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      delete(): Promise<unknown>;
    };
  };
}
