import { waitUntil } from '@vercel/functions';

/**
 * Le travail qu'une requête lance et qui finit après sa réponse : un tour d'Akari démarre avec la
 * réponse `202` et continue seul. Un serveur Node le laisse tourner ; une fonction Vercel doit en
 * être prévenue, sans quoi l'instance peut être figée dès la réponse envoyée, le tour en plein vol.
 */
export abstract class BackgroundWork {
  /** Garder le processus en vie jusqu'à la fin de ce travail (qui ne doit pas rejeter). */
  abstract keepAliveUntil(work: Promise<unknown>): void;
}

/**
 * `waitUntil` de Vercel : l'invocation dure jusqu'à la fin du travail, dans la limite de sa durée
 * maximale (300 s, `tools/vercel/build-output.mjs`). Hors d'une fonction Vercel (serveur Node,
 * développement), il ne fait rien : le travail tourne de toute façon.
 */
export class WaitUntilBackgroundWork extends BackgroundWork {
  keepAliveUntil(work: Promise<unknown>): void {
    waitUntil(work);
  }
}
