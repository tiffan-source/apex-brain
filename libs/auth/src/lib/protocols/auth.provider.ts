import { AuthSession } from '../models/auth-session';
import { User } from '../models/user';

export type Registration = {
  user: User;
  /** `null` tant que l'adresse e-mail doit être confirmée. */
  session: AuthSession | null;
};

/**
 * Port du fournisseur d'identité, sans état : rien n'est gardé entre deux appels, chaque
 * méthode reçoit ce dont elle a besoin (voir docs/adr/0003-authentification.md).
 *
 * Les implémentations traduisent leurs erreurs en erreurs du domaine : `UserAlreadyExistError`,
 * `WeakPasswordError`, `InvalidEmailError`, `InvalidCredentialsError`, `EmailNotConfirmedError`,
 * `InvalidSessionError`, `AuthRateLimitedError`.
 */
export abstract class AuthProvider {
  abstract register(email: string, password: string): Promise<Registration>;

  abstract login(email: string, password: string): Promise<AuthSession>;

  /** Échanger un jeton de renouvellement contre une nouvelle session. */
  abstract refresh(refreshToken: string): Promise<AuthSession>;

  /** Fermer la session portée par ce jeton d'accès. Fermer une session déjà fermée n'est pas une erreur. */
  abstract logout(accessToken: string): Promise<void>;

  /** La personne derrière un jeton d'accès valide, `null` si le jeton ne vaut rien. */
  abstract whoAmI(accessToken: string): Promise<User | null>;
}
