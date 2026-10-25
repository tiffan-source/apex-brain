export type CoreErrorMetadata = Record<string, unknown>;

/**
 * Erreur racine de l'application avec code stable et contexte optionnel.
 *
 * Le `code` est le contrat : les clients choisissent leur phrase d'après lui, jamais d'après
 * le `message` (technique, en anglais).
 */
export class CoreError extends Error {
  readonly code: string;
  readonly metadata?: CoreErrorMetadata;

  constructor(code: string, message: string, metadata?: CoreErrorMetadata) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.metadata = metadata;
  }
}
