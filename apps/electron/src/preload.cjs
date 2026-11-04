const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  fetch: async (path, options = {}) => {
    // The channel name 'api-request' must match the one in main.mts
    return ipcRenderer.invoke('api-request', {
      path,
      ...options,
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
