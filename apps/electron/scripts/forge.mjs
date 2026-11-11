// `pnpm run make` / `pnpm run package`: the store build for the OS it runs
// on, so each is one command everywhere.
//   make     Windows: the portable .zip and the Microsoft Store .msix (this machine's arch)
//            macOS:   the Mac App Store .pkg, one universal build for Intel and Apple silicon
//   package  The app folder only (out/), to try before making the packages.
//            macOS: the same sandboxed universal App Store app, but signed with
//            "Apple Development" + the development profile (MAS_DEV=1): a
//            distribution-signed one only runs once installed from the store.
// Extra arguments go through to Forge, e.g. `pnpm run make -- --arch=arm64`
// (an --arch given here wins over the default below).
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

const [command, ...extraArgs] = process.argv.slice(2);
if (command !== 'make' && command !== 'package') {
  console.error('Usage: node scripts/forge.mjs <make|package> [forge options]');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const forgeCli = path.join(
  path.dirname(require.resolve('@electron-forge/cli/package.json')),
  'dist/electron-forge.js',
);

const isMac = process.platform === 'darwin';
const hasArch = extraArgs.some(
  (arg) => arg === '--arch' || arg.startsWith('--arch='),
);
const platformArgs = isMac
  ? ['--platform=mas', ...(hasArch ? [] : ['--arch=universal'])]
  : [];

const { status } = spawnSync(
  process.execPath,
  [forgeCli, command, ...platformArgs, ...extraArgs],
  {
    stdio: 'inherit',
    env:
      isMac && command === 'package'
        ? { ...process.env, MAS_DEV: '1' }
        : process.env,
  },
);
process.exit(status ?? 1);
