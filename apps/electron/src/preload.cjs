const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  fetch: async (path, options = {}) => {
    // The channel name 'api-request' must match the one in main.mts
    return ipcRenderer.invoke('api-request', {
      path,
      ...options,
    });
  },
  readFile: (path) => ipcRenderer.invoke('file:readFile', path),
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
