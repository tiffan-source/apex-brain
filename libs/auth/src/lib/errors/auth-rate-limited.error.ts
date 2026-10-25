import { CoreError } from '@org/chore';

/** Le fournisseur d'identité refuse temporairement les tentatives (trop de demandes). */
export class AuthRateLimitedError extends CoreError {
  constructor() {
    super('TOO_MANY_REQUESTS', 'Too many authentication attempts, try again later.');
  }
}
