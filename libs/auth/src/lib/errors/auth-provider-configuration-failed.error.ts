import { CoreError } from '@org/chore';

export class AuthProviderConfigurationFailedError extends CoreError {
  constructor(message: string) {
    super('AUTH_PROVIDER_CONFIGURATION_FAILED_ERROR_CODE', message);
  }
}
