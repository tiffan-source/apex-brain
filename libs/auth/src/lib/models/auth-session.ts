import { User } from './user';

/**
 * Une session ouverte auprès du fournisseur d'identité : le jeton d'accès à présenter à chaque
 * requête, le jeton de renouvellement, et l'instant où le jeton d'accès expire.
 */
export interface AuthSession {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}
