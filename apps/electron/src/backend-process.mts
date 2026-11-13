/**
 * The backend — be-krang's Express app — in a process of its own.
 *
 * It ran in Electron's main process before, and that process also hands the
 * window its mouse, keyboard and scroll input: while a search or the indexing
 * of a folder kept it busy, the whole window froze. main.mts starts this
 * process with utilityProcess.fork() (see backend.mts) and gives each window
 * a port to it, so requests and answers go between the two directly. The
 * answer to a search can be tens of MB, and the main process never copies it.
 */
import { once } from 'events';
import fs from 'fs';
import http from 'http';
import { Readable, duplexPair } from 'stream';
import type { Duplex } from 'stream';
import { pipeline } from 'stream/promises';
import { pathToFileURL } from 'url';

import type {
  ApiRequest,
  ApiResponse,
  PortAbort,
  PortReply,
  PortRequest,
} from './backend-messages.mjs';

// Not an argument: be-krang starts an HTTP server of its own when it is the
// script process.argv[1] names
const backendPath = process.env.DOC_NINJA_BACKEND_PATH;

const expressApp: Promise<any> = (async () => {
  if (!backendPath) throw new Error('DOC_NINJA_BACKEND_PATH is not set');
  const backendModule = await import(pathToFileURL(backendPath).href);
  return backendModule.app;
})();

expressApp.catch((error) => {
  console.error('❌ The backend failed to load', error);
  process.exit(1);
});

/**
 * Answers a request with the Express app, as an HTTP request would be.
 *
 * Over a connection made in memory, not a socket: an HTTP server that
 * listens, even on the loopback only, needs the sandbox's
 * com.apple.security.network.server entitlement, and App Review refuses that
 * entitlement to an app that serves nothing to the network. The app gets a
 * real http.IncomingMessage and http.ServerResponse all the same, the way
 * Node's own http tests drive a server over a duplexPair().
 *
 * Once `signal` aborts, the connection closes: the app sees what it sees of
 * a fetch() cancelled in a browser, and stops (see abortedWhenClientLeaves
 * in be-krang). It then rejects.
 */
const answer = async (
  app: any,
  apiRequest: ApiRequest,
  signal: AbortSignal,
): Promise<ApiResponse> => {
  signal.throwIfAborted();
  // A server that never listens: it gets its one connection from here
  const [clientEnd, serverEnd] = duplexPair();
  http.createServer(app).emit('connection', serverEnd);
  try {
    return await answerOn(clientEnd, apiRequest, signal);
  } finally {
    // Both ends, whatever happened: once the answer is sent this changes
    // nothing for the app; before, its response closes unanswered — the abort
    clientEnd.destroy();
    serverEnd.destroy();
  }
};

/**
 * The request's body as the app reads it off the wire, and its Content-Type.
 *
 * !IMPORTANT: body is serialized by {serializeElectronIPCBody} in the
 * Front-End application (fetch-request.ts in ui-sauce): a FormData can't be
 * copied over IPC, so it comes as its files and fields, and is put together
 * again here.
 */
const encodeBody = async (
  body: ApiRequest['body'],
  electronAPIMeta: ApiRequest['electronAPIMeta'],
): Promise<{ contentType?: string; content: Readable }> => {
  if (electronAPIMeta?.isMultipart) {
    const form = new FormData();
    for (const file of body.files ?? []) {
      // From disk when the file has a path, read only as it is sent
      const blob = file.path
        ? await fs.openAsBlob(file.path, { type: file.type })
        : file.data && new Blob([Buffer.from(file.data)], { type: file.type });
      if (blob) form.append(file.key, blob, file.name);
    }
    for (const [key, value] of Object.entries(body.fieldByName ?? {})) {
      form.append(key, String(value));
    }
    // Encoded as fetch() encodes a FormData body, boundary and all
    const encoded = new Response(form);
    return {
      contentType: encoded.headers.get('content-type')!,
      content: Readable.fromWeb(encoded.body as any),
    };
  }
  if (typeof body === 'string') {
    return { contentType: 'application/json', content: Readable.from([body]) };
  }
  return { content: Readable.from([]) };
};

/**
 * Sends the request over `connection`, to the app at its other end, and
 * waits for the answer.
 */
const answerOn = async (
  connection: Duplex,
  { method, path, body, electronAPIMeta }: ApiRequest,
  signal: AbortSignal,
): Promise<ApiResponse> => {
  const { contentType, content } = await encodeBody(body, electronAPIMeta);

  const req = http.request({
    method,
    path,
    headers: {
      ...(contentType && { 'content-type': contentType }),
      // One request per connection: answer() closes it after this one
      connection: 'close',
    },
    createConnection: () => connection as any,
    // Aborted, the request fails with an AbortError, and so does the wait
    // below
    signal,
  });
  // Waited for together: the app may answer before it reads the whole body
  // (a bad request, a file too big)
  const [[res]] = (await Promise.all([
    once(req, 'response'),
    pipeline(content, req),
  ])) as [[http.IncomingMessage], void];

  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');

  // Parsed from JSON, as the UI expects it; every be-krang route answers in
  // JSON, anything else (Express's own error pages) gives an empty object
  const isJSON = /[/+]json\b/.test(res.headers['content-type'] ?? '');
  return {
    status: res.statusCode!,
    body: isJSON && text ? JSON.parse(text) : {},
  };
};

// A window's port to this process, from the main process
process.parentPort.on('message', ({ data, ports: [port] }) => {
  if (data?.type !== 'connect' || !port) return;

  // This window's requests not answered yet, by id: each window counts its own
  const abortControllers = new Map<number, AbortController>();

  port.on(
    'message',
    async ({ data: message }: { data: PortRequest | PortAbort }) => {
      if ('abort' in message) {
        abortControllers.get(message.id)?.abort();
        return;
      }

      const { id, request } = message;
      const abortController = new AbortController();
      abortControllers.set(id, abortController);

      let reply: PortReply;
      try {
        reply = {
          id,
          response: await answer(
            await expressApp,
            request,
            abortController.signal,
          ),
        };
      } catch (error) {
        reply = {
          id,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        abortControllers.delete(id);
      }
      // The window stopped waiting for it
      if (abortController.signal.aborted) return;
      port.postMessage(reply);
    },
  );
  port.start();
});
