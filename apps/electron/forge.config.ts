import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerMSIX } from '@electron-forge/maker-msix';
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

// The Microsoft Store identity and the build machine's Windows SDK come from
// the environment (or apps/electron/.env, see .env.example), so a release
// build never edits this file. Variables already set in the shell win.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const requireMsixEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set: the MSIX package needs it. Set it in the shell or in apps/electron/.env (see .env.example).`,
    );
  }
  return value;
};

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
    // A function, so the variables are read only when an MSIX package is
    // made: `start` and the other makers run without them.
    new MakerMSIX(() => ({
      // Pin to the installed SDK; electron-windows-msix otherwise derives the
      // build-tooling version from packageMinOSVersion below and fails if that
      // exact SDK isn't installed.
      windowsKitVersion: requireMsixEnv('MSIX__WINDOWS_KIT_VERSION'),
      // Real tile/logo assets — without this, electron-windows-msix falls back to
      // its bundled placeholder images, which fails Store cert 10.1.1.11.
      packageAssets: path.join(__dirname, 'images/msix-assets'),
      manifestVariables: {
        appDisplayName: 'DocNinja',
        // From Partner Center > Product identity
        packageIdentity: requireMsixEnv('MSIX__PACKAGE_IDENTITY'),
        publisher: `CN=${requireMsixEnv('MSIX__PUBLISHER_ID')}`,
        publisherDisplayName: requireMsixEnv('MSIX__PUBLISHER_DISPLAY_NAME'),
        // Store rejects packages targeting MinVersion <= 10.0.17134.0; default in
        // electron-windows-msix (10.0.14393.0) is below that, so set it explicitly.
        // 10.0.19041.0 (Win10 2004) also covers Windows 11 since both share the
        // "Windows.Desktop" device family — there's no separate way to cap at Win10 only.
        packageMinOSVersion: '10.0.19041.0',
        packageMaxOSVersionTested: '10.0.19041.0',
      },
    })),
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
