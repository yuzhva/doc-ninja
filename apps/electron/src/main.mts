import { app as electronApp, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';

// Import your refactored Express app
import { app as expressApp } from '../../be-krang/src/main.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // Use the constant provided by Electron Forge to load the compiled preload script
      preload: path.join(__dirname, 'preload.cjs')
    },
  });

  // Resolve the absolute path to the React build's index.html
  // For development (when files are in the workspace)
  let reactIndexPath = path.resolve(__dirname, '../../ui-sauce/dist/public/server.html');
  
  // For production (when files are packaged with the app)
  if (electronApp.isPackaged) {
    reactIndexPath = path.join(process.resourcesPath, 'ui-sauce/dist/public/server.html');
  }

  win.loadFile(reactIndexPath);
};

electronApp.whenReady().then(() => {
  // Handle IPC calls from the React UI
  ipcMain.handle('api-request', async (event, { method, path, body }) => {
    // Use supertest to make an "in-memory" request to your Express app
    const response = await request(expressApp)[method.toLowerCase()](path).send(body);

    // Return the response body and status to the UI
    return { status: response.status, body: response.body };
  });

  createWindow();

  electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

electronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    electronApp.quit();
  }
});