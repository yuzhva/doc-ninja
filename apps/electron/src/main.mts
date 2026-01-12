import {
  BrowserWindow,
  Menu,
  dialog,
  app as electronApp,
  ipcMain,
  nativeImage,
  screen,
  shell,
} from 'electron';
import * as fs from 'fs';
import path from 'path';
import request from 'supertest';
import { FileSystemService } from 'toolkit--local/browser';
import { FileScannerNode } from 'toolkit--local/node';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Hold the express app instance
let expressApp: any;

const createWindow = () => {
  // Step-1: Set the application menu to null to remove the default menu bar
  Menu.setApplicationMenu(null); // This is the key step

  const { workAreaSize } = screen.getPrimaryDisplay();

  // Step-2: Use nativeImage for more reliable cross-platform results,
  // or a direct path can sometimes work depending on the setup
  const iconPath = path.join(__dirname, '../images/icons/png/1024x1024.png');
  const customIcon = nativeImage.createFromPath(iconPath);

  // Step-3: Create the browser window with the custom icon
  const win = new BrowserWindow({
    width: workAreaSize.width * 0.75,
    height: workAreaSize.height * 0.75,
    title: 'DocNinja',
    icon: customIcon,
    webPreferences: {
      // Use the constant provided by Electron Forge to load the compiled preload script
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Resolve the absolute path to the React build's index.html
  // For development (when files are in the workspace)
  let reactIndexPath = path.resolve(
    __dirname,
    '../../ui-sauce/dist/public/server.html',
  );

  // For production (when files are packaged with the app)
  if (electronApp.isPackaged) {
    reactIndexPath = path.join(
      process.resourcesPath,
      'dist/ui-sauce/public/server.html',
    );
  }

  win.loadFile(reactIndexPath);
};

electronApp.whenReady().then(async () => {
  // Dynamically load the backend app
  let backendPath: string;
  if (electronApp.isPackaged) {
    // Production: use bundled files inside ASAR
    backendPath = path.join(
      process.resourcesPath,
      'dist/be-krang/cjs/index.cjs',
    );
  } else {
    // Development: use workspace files
    backendPath = path.resolve(__dirname, '../../be-krang/dist/cjs/index.cjs');
  }

  // Use dynamic import to load the module
  const backendModule = await import(pathToFileURL(backendPath).href);
  expressApp = backendModule.app;

  // Handle IPC calls from the React UI
  ipcMain.handle(
    'api-request',
    async (event, { method, path, body, electronAPIMeta }) => {
      // Use supertest to make an "in-memory" request to your Express app
      const req = request(expressApp)[method.toLowerCase()](path);

      /**
       * !IMPORTANT: body is serialized by {serializeElectronIPCBody} in Front-End application
       *
       * If you pass a FormData object to window.electronAPI.fetch(...), the preload script receives an empty object {} instead of the form data.
       * This happens because FormData is not "cloneable" by the structured clone algorithm used by Electron's IPC.
       *
       * Why it must stay in the Frontend
       * You must convert the FormData into a plain JavaScript object (JSON-serializable) before it crosses the bridge.
       * That is why the serialization logic lives in fetchRequest.ts inside the React app.
       */
      if (electronAPIMeta?.isMultipart) {
        // Reconstruct multipart request for supertest

        // 1. Attach files
        if (body.files) {
          for (const file of body.files) {
            if (file.path) {
              // Option A: Stream from disk (Best for performance)
              req.attach(file.key, file.path, {
                filename: file.name,
                contentType: file.type,
              });
            } else if (file.data) {
              // Option B: Buffer fallback (If path is missing)
              req.attach(file.key, Buffer.from(file.data), {
                filename: file.name,
                contentType: file.type,
              });
            }
          }
        }

        // 2. Attach text fields
        if (body.fieldByName) {
          for (const [key, value] of Object.entries(body.fieldByName)) {
            req.field(key, value as string);
          }
        }
      } else {
        const bodyAsJSON = JSON.parse(body);

        req.send(bodyAsJSON);
      }

      const response = await req;

      // Return the response body and status to the UI
      return { status: response.status, body: response.body };
    },
  );

  // Handle file reading
  ipcMain.handle('file:readFile', async (event, filePath: string) => {
    return FileScannerNode.safeReadFile(filePath);
  });

  // Handle file opening (shell integration)
  ipcMain.handle('shell:openPath', async (event, filePath: string) => {
    console.log(`📂 Opening file via shell: ${filePath}`);
    // shell.openPath returns empty string on success, or error message on failure
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      console.error(`❌ Failed to open path: ${errorMessage}`);
    }
    return errorMessage;
  });

  // Handle File/Directory Picker
  ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: options?.properties || ['openFile'],
      filters: options?.filters,
    });

    if (canceled || filePaths.length === 0) {
      return null;
    }

    const filePath = filePaths[0];
    const name = path.basename(filePath);
    const isDirectory = options?.properties?.includes('openDirectory');

    if (isDirectory) {
      const scannedFiles = await FileScannerNode.scanDirectory(filePath);

      // Map to serializable DTOs to avoid "object could not be cloned" error
      // Functions (like getFileContent) cannot be passed via IPC
      const files = scannedFiles.map((file) => ({
        ...file,
        // path: path.join(filePath, file.path),
      }));

      return {
        name,
        filePath,
        files,
      };
    }

    const stats = await fs.promises.stat(filePath);

    // Return a structure compatible with FileSystemItem + absolutePath
    return {
      name: name,
      path: filePath,
      size: stats.size,
      modifiedAt: stats.mtime,
      extension: FileSystemService.getFileExtension(filePath),
      fsItemType: 'file',
    };
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
