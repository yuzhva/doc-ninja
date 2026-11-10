import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerMSIX } from '@electron-forge/maker-msix';
import { MakerPKG } from '@electron-forge/maker-pkg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// The store identities (Microsoft Store MSIX, Mac App Store) and the build
// machine's Windows SDK come from
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

// Mac App Store build: only for `--platform=mas`, so the darwin zip and the
// Windows/Linux builds stay as they are.
const cliPlatform = (() => {
  const index = process.argv.findIndex(
    (arg) => arg === '--platform' || arg.startsWith('--platform='),
  );
  if (index === -1) return undefined;
  return process.argv[index].split('=')[1] ?? process.argv[index + 1];
})();
const isMasBuild = cliPlatform === 'mas';
// MAS_DEV=1 signs with "Apple Development" + the development profile: the
// only way to launch a sandboxed MAS build on this Mac. A distribution-signed
// one runs only once installed from the store/TestFlight.
const isMasDevBuild = isMasBuild && process.env.MAS_DEV === '1';
// Entitlements and provisioning profiles: see mac-app-store/README.md
const masDir = path.join(__dirname, 'mac-app-store');

const requireMasEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set: the Mac App Store build needs it. Set it in the shell or in apps/electron/.env (see .env.example).`,
    );
  }
  return value;
};

// One universal build serves Intel and Apple silicon, so the PyInstaller
// binaries must hold both architectures. @electron/universal can't merge
// them (they are the same file in the x64 and arm64 halves), so it is told to
// keep them as they are (osxUniversal.x64ArchFiles) — checked here first.
const pythonScriptsGlob = '**/python-scripts/*';
if (isMasBuild) {
  const pythonScriptsDir = path.join(beDest, 'python-scripts');
  const binaries = fs.existsSync(pythonScriptsDir)
    ? fs.readdirSync(pythonScriptsDir)
    : [];
  if (binaries.length === 0) {
    throw new Error(
      `No Python binaries in ${pythonScriptsDir}: run \`pnpm run build--release\` in apps/be-krang first.`,
    );
  }
  for (const binary of binaries) {
    const archs = execFileSync('lipo', [
      '-archs',
      path.join(pythonScriptsDir, binary),
    ])
      .toString()
      .trim()
      .split(' ');
    if (!archs.includes('x86_64') || !archs.includes('arm64')) {
      throw new Error(
        `be-krang/dist/python-scripts/${binary} is ${archs.join('+')} only; the store build needs x86_64+arm64. Rebuild it with the python.org (universal2) Python: see apps/be-krang/scripts/build-python-source-code.mjs.`,
      );
    }
  }
}

const masPackagerConfig = (): ForgeConfig['packagerConfig'] => {
  const teamId = requireMasEnv('MAS__TEAM_ID');
  // The name in the certificate titles, e.g. "Apple Distribution: <name> (<team id>)"
  const signerName = requireMasEnv('MAS__SIGNER_NAME');
  const bundleId = requireMasEnv('MAS__BUNDLE_ID');

  const profileName = isMasDevBuild
    ? 'DocNinja_Dev_Profile.provisionprofile'
    : 'DocNinja_MAS_Distribution_Profile.provisionprofile';
  const profilePath = path.join(masDir, profileName);
  if (!fs.existsSync(profilePath)) {
    throw new Error(
      `mac-app-store/${profileName} is missing: download it from developer.apple.com (see mac-app-store/README.md).`,
    );
  }
  // The profile is made for one Team ID + Bundle ID; signing with any other
  // pair gives an app the store (or this Mac) refuses.
  const profileAppId = execFileSync(
    'plutil',
    [
      '-extract',
      'Entitlements.com\\.apple\\.application-identifier',
      'raw',
      '-o',
      '-',
      '-',
    ],
    {
      input: execFileSync('security', ['cms', '-D', '-i', profilePath]),
    },
  )
    .toString()
    .trim();
  if (profileAppId !== `${teamId}.${bundleId}`) {
    throw new Error(
      `mac-app-store/${profileName} is for "${profileAppId}", but MAS__TEAM_ID + MAS__BUNDLE_ID give "${teamId}.${bundleId}".`,
    );
  }

  // CFBundleVersion: App Store Connect accepts each one once, so a re-upload
  // of the same app version needs a higher one. Defaults to package.json version.
  const buildVersion = process.env.MAS__BUILD_VERSION?.trim() || undefined;
  if (buildVersion && !/^\d+(\.\d+){0,2}$/.test(buildVersion)) {
    throw new Error(
      `MAS__BUILD_VERSION="${buildVersion}": App Store Connect takes at most three numbers (e.g. 1.6.1), not four.`,
    );
  }

  return {
    // Bundle/Dock name; otherwise it falls back to package.json "name".
    // MAS-only so the Windows exe name and userData folder stay unchanged.
    name: 'DocNinja',
    appBundleId: bundleId,
    buildVersion,
    // LSApplicationCategoryType — App Store Connect rejects uploads without it
    appCategoryType: 'public.app-category.productivity',
    osxSign: {
      // Matched as a substring of `security find-identity -v`
      identity: isMasDevBuild
        ? `Apple Development: ${signerName}`
        : `Apple Distribution: ${signerName} (${teamId})`,
      type: isMasDevBuild ? 'development' : 'distribution',
      provisioningProfile: profilePath,
      // Packager defaults this to true, which turns a signing failure into a
      // warning and leaves an unsigned app behind; for the store that is never
      // usable, so fail the build instead. Honoured by @electron/packager's
      // mac signing, but missing from its type.
      // @ts-expect-error
      continueOnError: false,
      optionsForFile: (filePath: string) => ({
        // Top-level DocNinja.app gets the real sandbox entitlements; every
        // nested binary (helpers, PyInstaller executables) only inherits them.
        entitlements: path.join(
          masDir,
          filePath.includes('.app/')
            ? 'entitlements.mas.child.plist'
            : 'entitlements.mas.plist',
        ),
        // Not required by the App Store, and its library validation would
        // refuse the Python runtime PyInstaller --onefile binaries unpack
        // and load at run time.
        hardenedRuntime: false,
      }),
    },
  };
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Sets the icon for the app executable.
    // Omit the extension; Forge looks for .ico on Windows and .icns on macOS.
    // Make sure 'apps/electron/images/icons/icon.ico' exists!
    icon: path.join(__dirname, 'images/icons/icon'),
    extraResource: [distDir],
    // Any `--arch=universal` build (mas and darwin): keep the universal2
    // PyInstaller binaries as they are instead of merging them
    osxUniversal: { x64ArchFiles: pythonScriptsGlob },
    ...(isMasBuild && masPackagerConfig()),
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
    // The .pkg uploaded to App Store Connect, signed with the
    // "Mac Installer Distribution" certificate.
    new MakerPKG(
      () => ({
        identity: `3rd Party Mac Developer Installer: ${requireMasEnv('MAS__SIGNER_NAME')} (${requireMasEnv('MAS__TEAM_ID')})`,
      }),
      ['mas'],
    ),
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
