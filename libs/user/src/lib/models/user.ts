import { Role } from './role';

export class User {
  private readonly _uid: string;
  private readonly _email: string;
  private _emailVerified = false;
  private _displayName?: string;
  private _roles: readonly Role[] = [];

  constructor(uid: string, email: string) {
    this._uid = uid;
    this._email = email;
  }

  get uid(): string {
    return this._uid;
  }

  get email(): string {
    return this._email;
  }

  get emailVerified(): boolean {
    return this._emailVerified;
  }

  get displayName(): string | undefined {
    return this._displayName;
  }

  /** Vide pour un compte de base. */
  get roles(): readonly Role[] {
    return this._roles;
  }

  setEmailVerified(emailVerified: boolean): void {
    this._emailVerified = emailVerified;
  }

  setDisplayName(displayName: string): void {
    this._displayName = displayName;
  }

  setRoles(roles: readonly Role[]): void {
    this._roles = [...new Set(roles)];
  }
}
