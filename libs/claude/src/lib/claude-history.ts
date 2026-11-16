import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages';

/** Le résultat donné à Claude pour un outil dont le tour s'est arrêté avant d'en rapporter le résultat. */
export const INTERRUPTED_TOOL_RESULT =
  'No result: the previous turn was interrupted before the result of this tool call was received.';

/**
 * Les appels d'outils restés sans résultat à la fin d'un historique, clos par un résultat en erreur.
 *
 * Un tour interrompu pendant ses outils (panne de Claude, de la base, refus d'un outil qui lève)
 * laisse le dernier message de Claude sur des `tool_use`, et le workflow repart du message suivant
 * de la personne. L'API refuse un message qui ne commence pas par le `tool_result` de chacun : ces
 * résultats ouvrent donc le message suivant.
 */
export function closePendingToolUses(history: MessageParam[]): ToolResultBlockParam[] {
  const last = history.at(-1);
  if (last?.role !== 'assistant' || typeof last.content === 'string') return [];

  return last.content
    .filter((block): block is ToolUseBlockParam => block.type === 'tool_use')
    .map((block) => ({
      type: 'tool_result',
      tool_use_id: block.id,
      content: INTERRUPTED_TOOL_RESULT,
      is_error: true,
    }));
}

/**
 * Un tour commence par un message de la personne : un message `user` qui ne répond à aucun outil.
 * Couper l'historique au début d'un tour garde ensemble chaque `tool_use` et son `tool_result`, et
 * l'historique commence toujours par un message de la personne.
 */
function startsTurn(message: MessageParam): boolean {
  return (
    message.role === 'user' &&
    (typeof message.content === 'string' || message.content.every((block) => block.type !== 'tool_result'))
  );
}

/**
 * Les tours les plus récents qui tiennent dans `maxBytes` (taille des messages en JSON) : les plus
 * anciens sont oubliés, entiers. Le dernier tour reste, quelle que soit sa taille.
 */
export function keepRecentTurns(messages: MessageParam[], maxBytes: number): MessageParam[] {
  const sizes = messages.map((message) => Buffer.byteLength(JSON.stringify(message)));
  let size = sum(sizes);
  let start = 0;

  for (let cut = 1; cut < messages.length && size > maxBytes; cut += 1) {
    if (!startsTurn(messages[cut])) continue;
    size -= sum(sizes.slice(start, cut));
    start = cut;
  }

  return messages.slice(start);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
