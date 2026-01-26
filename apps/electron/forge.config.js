const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const fs = require('fs');
const path = require('path');

// Prepare dist directory
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Helper to copy directory recursively (Node 16.7+)
const copyDir = (src, dest) => {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
};

// Copy UI
const uiSource = path.join(__dirname, '../ui-sauce/dist');
const uiDest = path.join(distDir, 'ui-sauce');
if (fs.existsSync(uiSource)) copyDir(uiSource, uiDest);

// Copy Backend
const beSource = path.join(__dirname, '../be-krang/dist');
const beDest = path.join(distDir, 'be-krang');
if (fs.existsSync(beSource)) copyDir(beSource, beDest);

module.exports = {
  packagerConfig: {
    asar: true,
    // Sets the icon for the app executable.
    // Omit the extension; Forge looks for .ico on Windows and .icns on macOS.
    // Make sure 'apps/electron/images/icons/icon.ico' exists!
    icon: path.join(__dirname, 'images/icons/icon'),
    extraResource: [distDir],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        // Sets the icon for the Setup/Installer executable
        setupIcon: path.join(__dirname, 'images/icons/icon.ico'),
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
