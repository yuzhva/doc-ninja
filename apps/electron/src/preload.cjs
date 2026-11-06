const { contextBridge, ipcRenderer, webFrame } = require('electron');

// The backend runs in a process of its own (see backend-process.mts). The
// window asks the main process once for a port to it, then sends its requests
// and gets the answers straight through that port: the main process, which
// hands the window its input, never has to copy a big answer.
let backendPort = null; // a Promise of the MessagePort
let nextRequestId = 0;
const pendingRequests = new Map();

const getBackendPort = () =>
  (backendPort ??= new Promise((resolve) => {
    ipcRenderer.once('backend:port', ({ ports: [port] }) => {
      port.onmessage = ({ data }) => {
        const request = pendingRequests.get(data.id);
        if (!request) return;
        pendingRequests.delete(data.id);
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
});

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Resolves to { status, body }, body parsed from JSON
  fetch: async (path, options = {}) => {
    const port = await getBackendPort();
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      pendingRequests.set(id, { resolve, reject });
      port.postMessage({ id, request: { path, ...options } });
    });
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
