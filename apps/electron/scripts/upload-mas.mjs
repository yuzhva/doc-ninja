// Validates and uploads the newest Mac App Store .pkg (made by
// `pnpm run make` on macOS) to App Store Connect with Apple's altool.
// The build then shows up in App Store Connect > TestFlight after processing.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(appDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set: see apps/electron/.env.example.`);
    process.exit(1);
  }
  return value;
};
const apiKey = requireEnv('ASC__API_KEY_ID');
const apiIssuer = requireEnv('ASC__API_ISSUER_ID');

const makeDir = path.join(appDir, 'out/make');
const pkgs = fs.existsSync(makeDir)
  ? fs
      .readdirSync(makeDir, { recursive: true })
      .filter((file) => file.endsWith('.pkg'))
      .map((file) => path.join(makeDir, file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  : [];
if (pkgs.length === 0) {
  console.error(
    `No .pkg in ${makeDir}: run \`pnpm run make\` (on macOS) first.`,
  );
  process.exit(1);
}
const pkg = pkgs[0];
const auth = ['--api-key', apiKey, '--api-issuer', apiIssuer];

console.log(`🔎 Validating ${path.relative(appDir, pkg)} ...`);
execFileSync('xcrun', ['altool', '--validate-app', pkg, ...auth], {
  stdio: 'inherit',
});

console.log('⬆️ Uploading to App Store Connect ...');
execFileSync('xcrun', ['altool', '--upload-package', pkg, ...auth], {
  stdio: 'inherit',
});
console.log(
  '✅ Uploaded. It appears in App Store Connect > TestFlight once processed.',
);
