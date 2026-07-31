import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolkitDistDir = path.resolve(
  __dirname,
  '../../../packages/toolkit/dist',
);

const POLL_INTERVAL_MS = 200;
// TypeScript's watch compiler writes many files per pass, not atomically -
// an entry file can exist before a file it imports has been written. Instead
// of trusting a couple of "marker" files, wait until the whole dist tree
// (file count + latest mtime) stops changing for this long.
const QUIET_PERIOD_MS = 800;
const TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scanDistTree = (dir) => {
  let fileCount = 0;
  let latestMtimeMs = 0;
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        fileCount += 1;
        const { mtimeMs } = statSync(fullPath);
        if (mtimeMs > latestMtimeMs) latestMtimeMs = mtimeMs;
      }
    }
  }

  return { fileCount, latestMtimeMs };
};

console.log('⏳ Waiting for packages/toolkit build output to settle...');

const startedAt = Date.now();
let lastSnapshot = { fileCount: 0, latestMtimeMs: 0 };
let quietSince = null;

while (true) {
  if (Date.now() - startedAt > TIMEOUT_MS) {
    console.error('❌ Timed out waiting for packages/toolkit/dist to settle.');
    process.exit(1);
  }

  if (!existsSync(toolkitDistDir)) {
    quietSince = null;
    await sleep(POLL_INTERVAL_MS);
    continue;
  }

  const snapshot = scanDistTree(toolkitDistDir);
  const changed =
    snapshot.fileCount !== lastSnapshot.fileCount ||
    snapshot.latestMtimeMs !== lastSnapshot.latestMtimeMs;
  lastSnapshot = snapshot;

  if (changed || snapshot.fileCount === 0) {
    quietSince = Date.now();
  } else if (Date.now() - quietSince >= QUIET_PERIOD_MS) {
    break;
  }

  await sleep(POLL_INTERVAL_MS);
}

console.log('✅ packages/toolkit build output settled.');
