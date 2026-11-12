/**
 * Ce qu'un compte a de plus qu'un compte de base. Un compte sans rôle est un compte de base :
 * « basique » n'est pas un rôle (voir docs/adr/0008-roles.md).
 */
export const ROLES = ['admin', 'premium'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Les rôles d'une valeur venue de l'extérieur (les métadonnées d'un fournisseur d'identité) :
 * ce qui n'est pas un rôle connu est ignoré sans erreur, et chaque rôle n'est gardé qu'une fois.
 */
export function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isRole))];
}

/** Un seul des rôles demandés suffit. */
export function hasAnyRole(roles: readonly Role[], allowed: readonly Role[]): boolean {
  return allowed.some((role) => roles.includes(role));
}
