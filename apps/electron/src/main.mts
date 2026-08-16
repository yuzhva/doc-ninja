import {
  BrowserWindow,
  Menu,
  dialog,
  app as electronApp,
  ipcMain,
  nativeImage,
  net,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { FileSystemService } from 'toolkit--local/browser';
import { FileScannerNode } from 'toolkit--local/node';
import { pathToFileURL } from 'url';

// electron-forge's Vite plugin always bundles the main process to CommonJS,
// so Node provides `__dirname` natively at runtime.
declare const __dirname: string;

// Register scheme to support standard web APIs and absolute paths
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

// Hold the express app instance
let expressApp: any;

/**
 * Whether a URL should be handed to the user's real browser rather than
 * opened inside the app.
 *
 * The renderer is served from `app://` and every backend call goes through
 * IPC or the in-process express app (no localhost origin), so an http/https
 * URL in this app is by definition somewhere else — a feature-request board,
 * a privacy policy — and never part of DocNinja itself.
 *
 * Restricted to http/https on purpose: shell.openExternal hands the URL
 * straight to the OS, which will act on schemes that aren't web pages at all
 * (file://, plus whatever protocol handlers happen to be registered), so
 * anything else is left for the caller to refuse rather than forwarded.
 */
const isExternalWebUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Opens a URL in the user's browser, reporting whether it took ownership of
 * it — so callers can leave anything they don't handle (in-app navigation)
 * alone rather than having to repeat the check themselves.
 */
const openExternalWebUrl = (url: string): boolean => {
  if (!isExternalWebUrl(url)) return false;

  // openExternal rejects when the OS has no handler for the URL. Caught
  // rather than left dangling: an unhandled rejection in the main process is
  // a crash risk, and there is nothing useful to tell the user here anyway —
  // their browser simply didn't come up.
  shell.openExternal(url).catch((error) => {
    console.warn('Failed to open external link in the browser', url, error);
  });

  return true;
};

const createWindow = () => {
  // Step-1: Set the application menu to null to remove the default menu bar
  Menu.setApplicationMenu(null); // This is the key step

  const { workAreaSize } = screen.getPrimaryDisplay();

  // Step-2: Use nativeImage for more reliable cross-platform results,
  // or a direct path can sometimes work depending on the setup
  const iconPath = path.join(__dirname, '../../images/icons/1024x1024.png');
  const customIcon = nativeImage.createFromPath(iconPath);

  // Step-3: Create the browser window with the custom icon
  const win = new BrowserWindow({
    width: workAreaSize.width * 0.75,
    height: workAreaSize.height * 0.75,
    title: `DocNinja v${electronApp.getVersion()}`,
    icon: customIcon,
    webPreferences: {
      // Use the constant provided by Electron Forge to load the compiled preload script
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // A target="_blank" link (how the app's external links — feature requests,
  // privacy policy — are written) otherwise opens a *second Electron window*:
  // a browser with no address bar, no back button and no menu bar (see
  // setApplicationMenu(null) above), so the user lands on an external page
  // with no way out except closing it. Send those to the real browser and
  // refuse the window instead. Non-web schemes are denied without being
  // forwarded anywhere — see isExternalWebUrl.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalWebUrl(url);
    return { action: 'deny' };
  });

  // The same reasoning for a link *without* target="_blank", which would
  // navigate the app window itself away from the UI — an even worse dead end,
  // since there's no window left showing DocNinja at all. Navigation within
  // the app's own app:// origin is untouched.
  win.webContents.on('will-navigate', (event, url) => {
    if (openExternalWebUrl(url)) event.preventDefault();
  });

  // Load via custom protocol to ensure absolute paths (like /static-assets) work correctly
  win.loadURL('app://doc-ninja/server.html');
};

electronApp.whenReady().then(async () => {
  // Define where the web app files are located
  let webappRoot: string;
  if (electronApp.isPackaged) {
    webappRoot = path.join(process.resourcesPath, 'dist/ui-sauce/public');
  } else {
    webappRoot = path.resolve(__dirname, '../../../ui-sauce/dist/public');
  }

  // Handle requests to app:// protocol
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    // Remove leading slash to join correctly
    const pathname = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const fullPath = path.join(webappRoot, pathname);
    return net.fetch(pathToFileURL(fullPath).toString());
  });

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
    backendPath = path.resolve(
      __dirname,
      '../../../be-krang/dist/cjs/index.cjs',
    );
  }

  // Use dynamic import to load the module
  const backendModule = await import(pathToFileURL(backendPath).href);
  expressApp = backendModule.app;

  // Handle IPC calls from the React UI
  ipcMain.handle(
    'api-request',
    async (event, { method, path, body, electronAPIMeta }) => {
      // Use supertest to make an "in-memory" request to your Express app
      const req = (request(expressApp) as any)[method.toLowerCase()](path);

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

  // The renderer's showOpenFilePicker/showDirectoryPicker calls (File System
  // Access API — see file-system-bridge.ts) hang indefinitely if the user
  // picks a Chromium-restricted path (home dir, Desktop, Documents, or
  // Downloads *root*), because nothing answers this event by default in
  // Electron — unlike a real Chrome tab, which shows its own "choose a
  // different folder" prompt for exactly this case. 'tryAgain' reopens the
  // native picker immediately, matching that same real-browser behavior
  // instead of leaving the picker's promise pending forever.
  session.defaultSession.on(
    'file-system-access-restricted',
    (_event, _details, callback) => {
      callback('tryAgain');
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
