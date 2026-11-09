// NOTE: add some default options like headers here
const DEFAULT_REQUEST_OPTION__BY_KEY = {
  headers: {
    // TODO: do not pass {application/json}, parse JSON by default on Server Side
    'Content-Type': 'application/json',
  },
};

interface ElectronFile {
  key: string;
  name: string;
  type: string;
  path?: string;
  data?: Uint8Array;
}

interface SerializedFormData {
  files: ElectronFile[];
  fieldByName: Record<string, FormDataEntryValue>;
}

/**
 * !IMPORTANT
 *
 * If you pass a FormData object to window.electronAPI.fetch(...), the preload script receives an empty object {} instead of the form data.
 * This happens because FormData is not "cloneable" by the structured clone algorithm used by Electron's IPC.
 *
 * Why it must stay in the Frontend
 * You must convert the FormData into a plain JavaScript object (JSON-serializable) before it crosses the bridge.
 * That is why the serialization logic lives in fetchRequest.ts inside the React app.
 */
const serializeElectronIPCBody = async (requestBody: any) => {
  if (requestBody instanceof FormData) {
    const serializedElectronIPCBody: SerializedFormData = {
      files: [],
      fieldByName: {},
    };

    // Iterate over FormData entries
    // We use a loop compatible with async/await for buffer reading
    const entries = Array.from(requestBody.entries());

    for (const [key, value] of entries) {
      if (value instanceof File) {
        // Try to get path (Electron), fallback to buffer
        const filePath = (value as any).path;
        let fileData = undefined;

        if (!filePath) {
          const buffer = await value.arrayBuffer();
          fileData = new Uint8Array(buffer);
        }

        serializedElectronIPCBody.files.push({
          key,
          name: value.name,
          type: value.type,
          path: filePath,
          data: fileData,
        });
      } else {
        serializedElectronIPCBody.fieldByName[key] = value;
      }
    }

    return {
      // Replace body with serialized object
      body: serializedElectronIPCBody,
      // Add flag so preload/main know how to handle it
      electronAPIMeta: {
        isMultipart: true,
      },
    };
  }

  return { body: requestBody };
};

// Electron only, and only here: typed in place rather than in
// file-system-bridge's ElectronAPI, the way use-app-zoom types setZoomFactor.
type ElectronFetchAbortAPI = { abortFetch?: (abortKey: string) => void };

let nextAbortKey = 0;

/**
 * Electron's fetch, cancelled by `signal` the way fetch() is: it rejects at
 * once with the signal's reason, and the backend stops working on the
 * request. A signal can't cross over to the preload script, so the request
 * goes with a key instead, which abortFetch cancels it by.
 */
const fetchViaElectron = (
  electronPath: string,
  options: any,
  signal: AbortSignal | undefined,
): Promise<any> => {
  if (!signal) return window.electronAPI!.fetch(electronPath, options);
  if (signal.aborted) return Promise.reject(signal.reason);

  const abortKey = `fetch-${nextAbortKey++}`;
  const answer = window.electronAPI!.fetch(electronPath, {
    ...options,
    abortKey,
  });

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      (window.electronAPI as ElectronFetchAbortAPI).abortFetch?.(abortKey);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    answer
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
};

async function fetchRequest(path: string, customOptions) {
  const options = Object.assign(
    {},
    // If the body is FormData, let the browser set the Content-Type header
    customOptions.body instanceof FormData
      ? {}
      : DEFAULT_REQUEST_OPTION__BY_KEY,
    customOptions,
  );
  // const request = new Request(path, options);

  if (window.electronAPI) {
    const electronPath = path.replace('/api-local/', '/');
    // A signal doesn't go over to the preload script: see fetchViaElectron
    const { signal, ...electronOptions } = options;

    const electronAPIRequestOptions = {
      ...electronOptions,
      ...(await serializeElectronIPCBody(electronOptions.body)),
    };

    return fetchViaElectron(
      electronPath,
      electronAPIRequestOptions,
      signal,
    ).then((response) => {
      // NOTE: the response from {ipcMain.handle('api-request'} is already parsed to JSON
      // return unified response format same as the Fetch API
      return response.body;
    });
  }

  return fetch(path, options).then((res) => res.json());
}

export { fetchRequest };
