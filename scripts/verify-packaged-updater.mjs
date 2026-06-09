/**
 * Verifies electron-updater can load from packaged runtime-deps without the dev repo's node_modules.
 * Run after electron-builder (see package.json electron:build).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const runtimeDeps = path.join(repoRoot, 'release', 'win-unpacked', 'resources', 'runtime-deps');

if (!fs.existsSync(runtimeDeps)) {
  console.error('verify-packaged-updater: runtime-deps missing — run electron-builder first');
  process.exit(1);
}

const requiredPackages = [
  'electron-updater',
  'builder-util-runtime',
  'debug',
  'ms',
  'tiny-typed-emitter',
  'lodash.escaperegexp',
];

for (const pkg of requiredPackages) {
  const pkgPath = path.join(runtimeDeps, 'node_modules', pkg, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(`verify-packaged-updater: missing runtime package "${pkg}"`);
    process.exit(1);
  }
}

const tempRoot = mkdtempSync(path.join(tmpdir(), 'nexor-updater-'));
try {
  cpSync(runtimeDeps, path.join(tempRoot, 'runtime-deps'), { recursive: true });
  const updaterEntry = path.join(tempRoot, 'runtime-deps', 'node_modules', 'electron-updater', 'package.json');
  const requireFromUpdater = createRequire(updaterEntry);
  requireFromUpdater('electron-updater');
  console.log('verify-packaged-updater: OK — electron-updater loads with packaged runtime-deps only');
} catch (err) {
  console.error('verify-packaged-updater: FAIL —', err?.message || err);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
