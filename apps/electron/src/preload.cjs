const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * A custom fetch-like function that sends the request to the Electron main process.
   * @param path The API path (e.g., '/api/v1').
   * @param options Standard Fetch API options.
   * @returns A promise that resolves with the response from the backend.
   */
  fetch: (path, options) => {
    // The channel name 'api-request' must match the one in main.mts
    return ipcRenderer.invoke('api-request', {
      path,
      method: options?.method || 'GET',
      body: options?.body ? JSON.parse(options.body) : undefined,
    });
  },
});
