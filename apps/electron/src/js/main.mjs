import { BrowserWindow, app, ipcMain } from 'electron/main';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  });

  // Resolve the absolute path to the React build's index.html
  // For development (when files are in the workspace)
  let reactIndexPath = path.resolve(
    __dirname,
    '../../ui-sauce/dist/public/server.html',
  );

  // For production (when files are packaged with the app)
  if (app.isPackaged) {
    reactIndexPath = path.join(
      process.resourcesPath,
      'ui-sauce/dist/public/server.html',
    );
  }

  win.loadFile(reactIndexPath);
};

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('ping', () => 'pong');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
