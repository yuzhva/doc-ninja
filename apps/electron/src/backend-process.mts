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
import http from 'http';
import request from 'supertest';
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
 * Once `signal` aborts, the request's connection closes: the app sees what
 * it sees of a fetch() cancelled in a browser, and stops (see
 * abortedWhenClientLeaves in be-krang). It then rejects.
 */
const answer = async (
  app: any,
  apiRequest: ApiRequest,
  signal: AbortSignal,
): Promise<ApiResponse> => {
  // The server supertest would start for the app, started here to be closed
  // here: supertest closes its own only once an answer comes, and a
  // cancelled request gets none. On the loopback only — the window's
  // requests are all it takes.
  const server = http.createServer(app).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    signal.throwIfAborted();
    return await answerOn(server, apiRequest, signal);
  } finally {
    server.close();
  }
};

/** Sends the request to `server`, the app's, and waits for the answer. */
const answerOn = async (
  server: http.Server,
  { method, path, body, electronAPIMeta }: ApiRequest,
  signal: AbortSignal,
): Promise<ApiResponse> => {
  // Use supertest to make an "in-memory" request to your Express app
  const req = (request(server) as any)[method.toLowerCase()](path);

  /**
   * !IMPORTANT: body is serialized by {serializeElectronIPCBody} in Front-End application
   *
   * If you pass a FormData object to window.electronAPI.fetch(...), the preload script receives an empty object {} instead of the form data.
   * This happens because FormData is not "cloneable" by the structured clone algorithm used by Electron's IPC.
   *
   * Why it must stay in the Frontend
   * You must convert the FormData into a plain JavaScript object (JSON-serializable) before it crosses the bridge.
   * That is why the serialization logic lives in fetchRequest.ts inside the React app.
   */
  if (electronAPIMeta?.isMultipart) {
    // Reconstruct multipart request for supertest

    // 1. Attach files
    if (body.files) {
      for (const file of body.files) {
        if (file.path) {
          // Option A: Stream from disk (Best for performance)
          req.attach(file.key, file.path, {
            filename: file.name,
            contentType: file.type,
          });
        } else if (file.data) {
          // Option B: Buffer fallback (If path is missing)
          req.attach(file.key, Buffer.from(file.data), {
            filename: file.name,
            contentType: file.type,
          });
        }
      }
    }

    // 2. Attach text fields
    if (body.fieldByName) {
      for (const [key, value] of Object.entries(body.fieldByName)) {
        req.field(key, value as string);
      }
    }
  } else {
    const bodyAsJSON = JSON.parse(body);

    req.send(bodyAsJSON);
  }

  // A block, returning nothing: abort() returns the request, a thenable, and
  // an abort listener's thenable is awaited — its rejection (the very abort)
  // would go unhandled, and end this process
  signal.addEventListener(
    'abort',
    () => {
      req.abort();
    },
    { once: true },
  );
  const response = await req;

  // Return the response body and status to the UI
  return { status: response.status, body: response.body };
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
