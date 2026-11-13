// `pnpm run make:dmg` (macOS): the DocNinja.dmg to download from the website.
//
//   1. Packages the app for outside the App Store (forge.mjs package
//      --platform=darwin): signed with "Developer ID Application", hardened
//      runtime, notarized and stapled (see websiteMacPackagerConfig in
//      forge.config.ts).
//   2. Puts it in a disk image whose window shows the app, an arrow and the
//      Applications folder to drag it onto (laid out by Finder itself, from
//      images/dmg/background*.png).
//   3. Compresses it (ULMO, lzma: about a third of the app's size), then
//      signs, notarizes and staples the .dmg too, so Gatekeeper opens it
//      without a warning, even offline.
//
// Writes out/make/DocNinja-<version>-<arch>.dmg. Takes the same Forge
// options as `make`, e.g. `pnpm run make:dmg -- --arch=arm64` for an Apple
// silicon-only image (default: universal). `--skip-package` reuses the app
// already in out/, to try another layout without building it again.
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(appDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

if (process.platform !== 'darwin') {
  console.error('make:dmg runs on macOS only.');
  process.exit(1);
}

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set: see apps/electron/.env.example.`);
    process.exit(1);
  }
  return value;
};
// Checked before the build, which takes a while, not after it
const identity = `Developer ID Application: ${requireEnv('MAS__SIGNER_NAME')} (${requireEnv('MAS__TEAM_ID')})`;
const apiKeyId = requireEnv('ASC__API_KEY_ID');
const apiIssuer = requireEnv('ASC__API_ISSUER_ID');
const apiKeyPath = path.join(
  os.homedir(),
  '.appstoreconnect/private_keys',
  `AuthKey_${apiKeyId}.p8`,
);

const args = process.argv.slice(2);
const skipPackage = args.includes('--skip-package');
const forgeArgs = args.filter((arg) => arg !== '--skip-package');
const arch =
  forgeArgs.find((arg) => arg.startsWith('--arch='))?.split('=')[1] ??
  'universal';

// The volume's name: the window title, and how Finder is told which window
const VOLUME = 'DocNinja';
const APP = 'DocNinja.app';
// The window: the size of images/dmg/background.png, icons centred on the
// arrow's ends (Finder positions are the icons' centres)
const WINDOW = { width: 660, height: 400 };
const ICON_SIZE = 128;
const APP_POSITION = [165, 190];
const APPLICATIONS_POSITION = [495, 190];

const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { stdio: 'inherit', ...options });
const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// 1. The signed and notarized app
if (!skipPackage) {
  const { status } = spawnSync(
    process.execPath,
    [
      path.join(appDir, 'scripts/forge.mjs'),
      'package',
      '--platform=darwin',
      ...forgeArgs,
    ],
    { stdio: 'inherit', cwd: appDir },
  );
  if (status !== 0) process.exit(status ?? 1);
}
const appPath = path.join(appDir, `out/${VOLUME}-darwin-${arch}/${APP}`);
if (!fs.existsSync(appPath)) {
  console.error(
    `No ${path.relative(appDir, appPath)}: run without --skip-package.`,
  );
  process.exit(1);
}

const mountPoint = `/Volumes/${VOLUME}`;
if (fs.existsSync(mountPoint)) {
  console.error(
    `${mountPoint} is mounted already (an older DocNinja.dmg?): eject it first.`,
  );
  process.exit(1);
}

const version = JSON.parse(
  fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'),
).version;
const outDir = path.join(appDir, 'out/make');
const dmgPath = path.join(outDir, `${VOLUME}-${version}-${arch}.dmg`);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docninja-dmg-'));

try {
  // 2. What the window shows: the app, a link to /Applications, and the
  // background, in a hidden folder
  console.log('📦 Laying out the disk image ...');
  const stageDir = path.join(workDir, 'stage');
  fs.mkdirSync(path.join(stageDir, '.background'), { recursive: true });
  // ditto: keeps the app's signature, symlinks and extended attributes
  run('ditto', [appPath, path.join(stageDir, APP)]);
  fs.symlinkSync('/Applications', path.join(stageDir, 'Applications'));
  // One TIFF with both resolutions: Finder picks the @2x one on Retina screens
  run('tiffutil', [
    '-cathidpicheck',
    path.join(appDir, 'images/dmg/background.png'),
    path.join(appDir, 'images/dmg/background@2x.png'),
    '-out',
    path.join(stageDir, '.background/background.tiff'),
  ]);

  // Writable first, with room for the .DS_Store Finder writes the layout to
  const stageMb = Number(
    execFileSync('du', ['-sm', stageDir]).toString().split('\t')[0],
  );
  const rwDmg = path.join(workDir, 'rw.dmg');
  run('hdiutil', [
    'create',
    '-quiet',
    '-volname',
    VOLUME,
    '-srcfolder',
    stageDir,
    '-fs',
    'HFS+',
    '-format',
    'UDRW',
    '-size',
    `${stageMb + 50}m`,
    rwDmg,
  ]);

  run('hdiutil', [
    'attach',
    '-quiet',
    '-readwrite',
    '-noverify',
    '-noautoopen',
    '-mountpoint',
    mountPoint,
    rwDmg,
  ]);
  try {
    // Finder saves the window's look in the volume's .DS_Store. The first
    // run asks to let this terminal control Finder: allow it.
    const [left, top] = [200, 120];
    execFileSync('osascript', [], {
      stdio: ['pipe', 'inherit', 'inherit'],
      input: `
        tell application "Finder"
          tell disk "${VOLUME}"
            open
            set current view of container window to icon view
            set toolbar visible of container window to false
            set statusbar visible of container window to false
            -- + the title bar, so the whole background shows
            set the bounds of container window to {${left}, ${top}, ${left + WINDOW.width}, ${top + WINDOW.height + 22}}
            set viewOptions to the icon view options of container window
            set arrangement of viewOptions to not arranged
            set icon size of viewOptions to ${ICON_SIZE}
            set text size of viewOptions to 13
            set background picture of viewOptions to file ".background:background.tiff"
            set position of item "${APP}" of container window to {${APP_POSITION}}
            set position of item "Applications" of container window to {${APPLICATIONS_POSITION}}
            update without registering applications
            delay 2
            close
          end tell
        end tell`,
    });
    // Finder writes .DS_Store on its own time
    for (
      let i = 0;
      i < 20 && !fs.existsSync(path.join(mountPoint, '.DS_Store'));
      i++
    ) {
      sleep(500);
    }
    if (!fs.existsSync(path.join(mountPoint, '.DS_Store'))) {
      throw new Error('Finder saved no layout (.DS_Store) in the disk image.');
    }
    fs.rmSync(path.join(mountPoint, '.fseventsd'), {
      recursive: true,
      force: true,
    });
  } finally {
    // Finder or Spotlight may still hold it for a moment
    let detached = false;
    for (let i = 0; i < 5 && !detached; i++) {
      detached =
        spawnSync('hdiutil', ['detach', '-quiet', mountPoint]).status === 0;
      if (!detached) sleep(1000);
    }
    if (!detached) run('hdiutil', ['detach', '-force', mountPoint]);
  }

  // 3. Compressed, signed, notarized, stapled
  console.log('🗜️ Compressing ...');
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(dmgPath, { force: true });
  run('hdiutil', [
    'convert',
    '-quiet',
    rwDmg,
    '-format',
    'ULMO',
    '-o',
    dmgPath,
  ]);

  console.log('🔏 Signing ...');
  run('codesign', ['--sign', identity, '--timestamp', dmgPath]);

  console.log('📨 Notarizing (a few minutes) ...');
  run('xcrun', [
    'notarytool',
    'submit',
    dmgPath,
    '--key',
    apiKeyPath,
    '--key-id',
    apiKeyId,
    '--issuer',
    apiIssuer,
    '--wait',
  ]);
  // Fails when Apple didn't accept it: there's no ticket to staple then.
  // `xcrun notarytool log <submission id> --key ...` says why.
  run('xcrun', ['stapler', 'staple', dmgPath]);

  // What Gatekeeper will say on a user's Mac
  run('spctl', [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '-v',
    dmgPath,
  ]);
  run('spctl', ['--assess', '--type', 'execute', '-v', appPath]);

  const mb = (fs.statSync(dmgPath).size / 1024 / 1024).toFixed(0);
  console.log(`✅ ${path.relative(appDir, dmgPath)} (${mb} MB)`);
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
