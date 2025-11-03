// NOTE: add some default options like headers here
const DEFAULT_REQUEST_OPTION__BY_KEY = {
  headers: {
    // TODO: do not pass {application/json}, parse JSON by default on Server Side
    'Content-Type': 'application/json',
  },
};

function fetchRequest(path: string, customOptions) {
  const options = Object.assign({}, DEFAULT_REQUEST_OPTION__BY_KEY, customOptions);
  // const request = new Request(path, options);

  if (window.electronAPI) {
    const electronPath = path.replace('/api-local/', '/');

    return window.electronAPI.fetch(electronPath, options);
  }

  return fetch(path, options).then((res) => res.json());
}

export { fetchRequest };
