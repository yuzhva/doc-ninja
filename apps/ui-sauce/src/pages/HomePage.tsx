import React from 'react';

function fetchRequest(path: string, customOptions) 
  {// NOTE: add some default options like headers here
  const defaultRequestOptions = {
    headers: {
      // TODO: do not pass {application/json}, parse JSON by default on Server Side
      'Content-Type': 'application/json',
    },
  };

  const options = Object.assign({}, defaultRequestOptions, customOptions);
  // const request = new Request(path, options);

  if (window.electronAPI) {
    const electronPath = path.replace('/api-local/', '/');

    return window.electronAPI.fetch(electronPath, options);
  }

  return fetch(path, options).then((res) => res.json());
}

const HomePage = () => {
  const makePublicAPICall = React.useCallback(() => {
    // Use the Electron API if it exists, otherwise use standard web fetch
    const apiFetch = window.electronAPI ? window.electronAPI.fetch : fetch;
    
    fetchRequest('/api-local/welcome/public', {
      method: 'GET',
    }).then((resAsJson) => {
      console.log({ resAsJson });
    })
  }, []);

  return (
    <div>
      <h1>Welcome to React world</h1>
      <button onClick={makePublicAPICall}>Make API Call</button>
    </div>
  );
};

export { HomePage };