import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'fs';
import path from 'path';

// Prepare dist directory
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Helper to copy directory recursively (Node 16.7+)
const copyDir = (src: string, dest: string) => {
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

const config: ForgeConfig = {
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
    new MakerSquirrel({
      // Sets the icon for the Setup/Installer executable
      setupIcon: path.join(__dirname, 'images/icons/icon.ico'),
    }),
    new MakerZIP({}),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.mts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.cjs',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [],
    }),
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

export default config;
