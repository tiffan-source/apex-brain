import { Reflector } from '@nestjs/core';

/** Ce que déclare une route gouvernée par les politiques d'usage. */
export type UsageActionMetadata = {
  /** Le nom de l'action, tel que le nomment les politiques (table `usage_actions`). */
  action: string;
  /**
   * L'issue arrive après la réponse : la route répond `202` et l'opération se joue ensuite. L'unité reste
   * réservée jusqu'à ce que l'issue soit connue ; `subjectParam` est le paramètre de route qui désigne
   * l'opération en cours (un tour d'Akari : `objectiveId`).
   */
  deferredOutcome?: { subjectParam: string };
};

/**
 * Cette route (ou chaque route d'un contrôleur) est une action d'usage : les politiques d'usage décident si
 * la personne peut la faire, et combien de fois (docs/adr/0010-politiques-d-usage.md). L'étiquette est neutre :
 * elle ne dit rien de la règle, et une action qu'aucune politique ne nomme reste libre.
 */
export const UsageAction = Reflector.createDecorator<UsageActionMetadata>();
