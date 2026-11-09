const { contextBridge, ipcRenderer, webFrame } = require('electron');

// The backend runs in a process of its own (see backend-process.mts). The
// window asks the main process once for a port to it, then sends its requests
// and gets the answers straight through that port: the main process, which
// hands the window its input, never has to copy a big answer.
let backendPort = null; // a Promise of the MessagePort
let nextRequestId = 0;
const pendingRequests = new Map();
// The ids of the pending requests the renderer can cancel, by the key it
// gave each (see abortFetch)
const requestIdByAbortKey = new Map();

// Takes request `id` off the pending ones, and returns it
const settle = (id) => {
  const request = pendingRequests.get(id);
  pendingRequests.delete(id);
  if (request?.abortKey !== undefined) {
    requestIdByAbortKey.delete(request.abortKey);
  }
  return request;
};

const getBackendPort = () =>
  (backendPort ??= new Promise((resolve) => {
    ipcRenderer.once('backend:port', ({ ports: [port] }) => {
      port.onmessage = ({ data }) => {
        const request = settle(data.id);
        if (!request) return;
        if ('error' in data) request.reject(new Error(data.error));
        else request.resolve(data.response);
      };
      resolve(port);
    });
    ipcRenderer.send('backend:connect');
  }));

// What the backend was doing is lost; the next request starts it again
ipcRenderer.on('backend:stopped', (_event, reason) => {
  backendPort?.then((port) => port.close());
  backendPort = null;
  for (const request of pendingRequests.values()) {
    request.reject(new Error(reason));
  }
  pendingRequests.clear();
  requestIdByAbortKey.clear();
});

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Resolves to { status, body }, body parsed from JSON. With an `abortKey`
  // in the options, abortFetch(abortKey) cancels it.
  fetch: (path, { abortKey, ...options } = {}) =>
    new Promise((resolve, reject) => {
      // Pending from the call on, so a cancel never comes before it
      const id = nextRequestId++;
      pendingRequests.set(id, { resolve, reject, abortKey });
      if (abortKey !== undefined) requestIdByAbortKey.set(abortKey, id);
      getBackendPort().then((port) => {
        // Cancelled before the port was there: never sent
        if (pendingRequests.has(id)) {
          port.postMessage({ id, request: { path, ...options } });
        }
      });
    }),
  // Cancels the fetch given `abortKey`, if not answered yet: it rejects at
  // once, and the backend stops working on it (see backend-process.mts).
  abortFetch: (abortKey) => {
    const id = requestIdByAbortKey.get(abortKey);
    if (id === undefined) return;
    settle(id).reject(new Error('The request was cancelled'));
    backendPort?.then((port) => port.postMessage({ id, abort: true }));
  },
  // The window's zoom, 1 = 100% — what Ctrl + / Ctrl − do in a browser. The
  // app has no menu (see main.mts), so the UI offers it in its settings.
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  // Brings the app window to the front: window.focus() in the renderer only
  // focuses the page, it can't raise the window. Called when the user clicks
  // one of the app's system notifications (see notification-bridge.ts).
  focusWindow: () => ipcRenderer.send('window:focus'),
  readFile: (path) => ipcRenderer.invoke('file:readFile', path),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  getWritableDirectoryPath: (name) =>
    ipcRenderer.invoke('fileSystemAccess:getWritableDirectoryPath', name),
  showDirectoryPicker: () =>
    ipcRenderer.invoke('dialog:showOpenDialog', {
      properties: ['openDirectory'],
    }),
  showOpenFilePicker: (options) =>
    ipcRenderer.invoke('dialog:showOpenDialog', {
      properties: ['openFile'],
      filters: options?.types?.map((t) => ({
        name: t.description || 'Files',
        extensions: Object.values(t.accept)
          .flat()
          .map((ext) => ext.replace(/^\./, '')),
      })),
    }),
});
