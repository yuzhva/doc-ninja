// NOTE: add some default options like headers here
const DEFAULT_REQUEST_OPTION__BY_KEY = {
  headers: {
    // TODO: do not pass {application/json}, parse JSON by default on Server Side
    'Content-Type': 'application/json',
  },
};

function fetchRequest(path: string, customOptions) {
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

    return window.electronAPI.fetch(electronPath, options).then((response) => {
      // NOTE: the response from {ipcMain.handle('api-request'} is already parsed to JSON
      // return unified response format same as the Fetch API
      return response.body;
    });
  }

  return fetch(path, options).then((res) => res.json());
}

export { fetchRequest };
