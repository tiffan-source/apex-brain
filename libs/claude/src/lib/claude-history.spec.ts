import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { closePendingToolUses, INTERRUPTED_TOOL_RESULT, keepRecentTurns } from './claude-history';

const prompt = (text: string): MessageParam => ({ role: 'user', content: [{ type: 'text', text }] });
const answer = (text: string): MessageParam => ({ role: 'assistant', content: [{ type: 'text', text }] });
const toolUse = (id: string): MessageParam => ({
  role: 'assistant',
  content: [{ type: 'tool_use', id, name: 'getObjectiveTree', input: { id: 'o1' } }],
});
const toolResult = (id: string, content = '{}'): MessageParam => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content }],
});

describe('closePendingToolUses', () => {
  it("clôt d'un résultat en erreur chaque outil du dernier message de Claude", () => {
    const history: MessageParam[] = [
      prompt('Ajoute deux pas'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Je les ajoute.' },
          { type: 'tool_use', id: 'toolu_1', name: 'createTask', input: { title: 'A' } },
          { type: 'tool_use', id: 'toolu_2', name: 'createTask', input: { title: 'B' } },
        ],
      },
    ];

    expect(closePendingToolUses(history)).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: INTERRUPTED_TOOL_RESULT, is_error: true },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: INTERRUPTED_TOOL_RESULT, is_error: true },
    ]);
  });

  it("ne clôt rien quand Claude a répondu, ni quand l'historique est vide", () => {
    expect(closePendingToolUses([prompt('Salut'), answer('Bonjour.')])).toEqual([]);
    expect(closePendingToolUses([prompt('Salut'), toolUse('toolu_1'), toolResult('toolu_1')])).toEqual([]);
    expect(closePendingToolUses([])).toEqual([]);
  });
});

describe('keepRecentTurns', () => {
  const conversation: MessageParam[] = [
    prompt('Premier tour'),
    toolUse('toolu_1'),
    toolResult('toolu_1', 'x'.repeat(500)),
    answer('Voici ton arbre.'),
    prompt('Deuxième tour'),
    answer('Bien noté.'),
    prompt('Troisième tour'),
  ];
  const size = (messages: MessageParam[]) =>
    messages.reduce((total, message) => total + Buffer.byteLength(JSON.stringify(message)), 0);

  it('garde toute la conversation quand elle tient dans la taille maximale', () => {
    expect(keepRecentTurns(conversation, size(conversation))).toEqual(conversation);
  });

  it('oublie les tours les plus anciens, entiers, jusqu’à tenir dans la taille maximale', () => {
    expect(keepRecentTurns(conversation, size(conversation.slice(4)))).toEqual(conversation.slice(4));
  });

  it("ne coupe jamais entre un outil et son résultat : l'historique commence par un message de la personne", () => {
    // Couper juste avant le résultat d'outil suffirait à tenir : on coupe au début du tour suivant.
    const kept = keepRecentTurns(conversation, size(conversation.slice(2)));

    expect(kept).toEqual(conversation.slice(4));
    expect(kept[0]).toEqual(prompt('Deuxième tour'));
  });

  it('garde le dernier tour, quelle que soit sa taille', () => {
    expect(keepRecentTurns(conversation, 1)).toEqual([prompt('Troisième tour')]);
  });
});
