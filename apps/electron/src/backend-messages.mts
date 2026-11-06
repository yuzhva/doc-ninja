/**
 * What a window and the backend process (see backend-process.mts) send each
 * other over the port the main process gives them (see backend.mts).
 */

/** A request from the UI, as window.electronAPI.fetch() sends it (preload.cjs). */
type ApiRequest = {
  path: string;
  method: string;
  /**
   * JSON text, or — for a FormData body, which IPC can't copy — its files and
   * fields, as serializeElectronIPCBody (fetch-request.ts in ui-sauce) gives them
   */
  body?: any;
  electronAPIMeta?: { isMultipart?: boolean };
};

type ApiResponse = { status: number; body: unknown };

type PortRequest = { id: number; request: ApiRequest };

type PortReply =
  { id: number; response: ApiResponse } | { id: number; error: string };

export type { ApiRequest, ApiResponse, PortReply, PortRequest };
