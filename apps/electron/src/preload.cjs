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
});
