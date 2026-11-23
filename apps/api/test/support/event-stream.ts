import type { IncomingMessage } from 'node:http';
import { request } from 'node:http';

/** Un message reçu sur un flux SSE : son type (`event`), son id, ses données JSON. */
export type StreamMessage = { event: string; id?: string; data: unknown };

/**
 * Un client SSE minimal pour les tests, comme un client qui envoie l'en-tête `Authorization` : il lit le
 * flux au fil de l'eau et garde ses messages (les commentaires à part). Une connexion à lui, sans pool,
 * pour que la fermer la ferme vraiment.
 */
export async function openEventStream(url: string, authorization?: string) {
  const { req, res } = await new Promise<{ req: ReturnType<typeof request>; res: IncomingMessage }>(
    (resolve, reject) => {
      const req = request(
        url,
        {
          agent: false,
          headers: {
            Accept: 'text/event-stream',
            ...(authorization ? { Authorization: authorization } : {}),
          },
        },
        (res) => resolve({ req, res }),
      );
      req.on('error', reject);
      req.end();
    },
  );

  const messages: StreamMessage[] = [];
  const comments: string[] = [];
  const closed = new Promise<void>((resolve) => res.on('close', resolve));
  res.setEncoding('utf8');

  let body: unknown;
  if (res.statusCode === 200) {
    let buffer = '';
    res.on('data', (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        readFrame(buffer.slice(0, end), messages, comments);
        buffer = buffer.slice(end + 2);
      }
    });
    res.on('error', () => undefined);
  } else {
    let text = '';
    for await (const chunk of res) text += chunk;
    body = JSON.parse(text);
  }

  return {
    status: res.statusCode,
    contentType: res.headers['content-type'],
    /** Le corps d'une réponse refusée (JSON), avant tout flux. */
    body,
    messages,
    comments,
    /** Attendre le premier message, dans l'ordre d'arrivée, qui satisfait `predicate`. */
    waitFor: (predicate: (message: StreamMessage) => boolean): Promise<StreamMessage> =>
      vi.waitFor(
        () => {
          const found = messages.find(predicate);
          if (!found) throw new Error(`message attendu jamais reçu : ${JSON.stringify(messages)}`);
          return found;
        },
        { timeout: 3000 },
      ),
    close: async () => {
      req.destroy();
      await closed;
    },
  };
}

export type EventStream = Awaited<ReturnType<typeof openEventStream>>;

function readFrame(frame: string, messages: StreamMessage[], comments: string[]): void {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) {
      comments.push(line.slice(1).trim());
      continue;
    }
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }

  if (data.length > 0) messages.push({ event, id, data: JSON.parse(data.join('\n')) });
}
