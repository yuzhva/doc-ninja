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
