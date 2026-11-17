/**
 * Les rôles d'un compte. `standard` est le rôle par défaut : une personne sans rôle enregistré est
 * standard (voir docs/adr/0010-politiques-d-usage.md, qui remplace « basique n'est pas un rôle » de
 * docs/adr/0008-roles.md). Ce que chaque rôle peut faire, et combien de fois, est décidé par les
 * politiques d'usage, pas ici.
 */
export const ROLES = ['admin', 'premium', 'standard'] as const;

export type Role = (typeof ROLES)[number];

/** Le rôle d'une personne à qui aucun rôle n'a été donné. */
export const DEFAULT_ROLE: Role = 'standard';

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Les rôles d'une valeur venue de l'extérieur (les métadonnées d'un fournisseur d'identité) :
 * ce qui n'est pas un rôle connu est ignoré sans erreur, et chaque rôle n'est gardé qu'une fois.
 * Peut rendre une liste vide : c'est `User` qui applique le rôle par défaut.
 */
export function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isRole))];
}

/** Un seul des rôles demandés suffit. */
export function hasAnyRole(roles: readonly Role[], allowed: readonly Role[]): boolean {
  return allowed.some((role) => roles.includes(role));
}

/** Les rôles d'une personne : ceux qu'on lui a donnés, chacun une fois, sinon le rôle par défaut. */
export function withDefaultRole(roles: readonly Role[]): Role[] {
  const unique = [...new Set(roles)];
  return unique.length > 0 ? unique : [DEFAULT_ROLE];
}
