/**
 * Run data consistency checks with Electron's Node (better-sqlite3 ABI).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const backendRoot = path.join(root, 'backend');
const require = createRequire(import.meta.url);

const scriptPath = path.join(backendRoot, 'scripts/check-data-consistency.cjs');
const extraArgs = process.argv.slice(2);

function resolveElectronBinary() {
  try {
    const pkgJson = require.resolve('electron/package.json', { paths: [root] });
    const distDir = path.join(path.dirname(pkgJson), 'dist');
    if (process.platform === 'win32') {
      const exe = path.join(distDir, 'electron.exe');
      if (fs.existsSync(exe)) return exe;
    }
    const linux = path.join(distDir, 'electron');
    if (fs.existsSync(linux)) return linux;
  } catch {
    /* fall through */
  }
  return null;
}

const sqliteNode = path.join(backendRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!fs.existsSync(sqliteNode)) {
  console.error('[consistency] Missing better_sqlite3.node — run: cd backend && npm install && npm run rebuild:backend');
  process.exit(1);
}

const electron = resolveElectronBinary();
const nodeArgs = [scriptPath, ...extraArgs];

if (electron) {
  const result = spawnSync(electron, nodeArgs, {
    cwd: backendRoot,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
  });
  process.exit(result.status ?? 1);
}

console.log('[consistency] Electron not found — using system Node…');
const result = spawnSync(process.execPath, nodeArgs, { cwd: backendRoot, stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
