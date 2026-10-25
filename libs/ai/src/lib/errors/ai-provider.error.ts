import { CoreError, CoreErrorMetadata } from '@org/chore';

/** L'IA n'a pas pu répondre (indisponible, quota atteint, réponse inexploitable…). */
export class AIProviderError extends CoreError {
  constructor(message: string, metadata?: CoreErrorMetadata) {
    super('AI_PROVIDER_FAILURE', message, metadata);
  }
}
