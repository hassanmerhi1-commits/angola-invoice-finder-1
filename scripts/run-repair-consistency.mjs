/**
 * Run data consistency repairs with Electron's Node (better-sqlite3 ABI).
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

const scriptPath = path.join(backendRoot, 'scripts/repair-data-consistency.cjs');

function resolveElectronBinary() {
  try {
    const pkgJson = require.resolve('electron/package.json', { paths: [root] });
    const distDir = path.join(path.dirname(pkgJson), 'dist');
    if (process.platform === 'win32') {
      const exe = path.join(distDir, 'electron.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    /* fall through */
  }
  return null;
}

const electron = resolveElectronBinary();
const nodeArgs = [scriptPath];

if (electron) {
  const result = spawnSync(electron, nodeArgs, {
    cwd: backendRoot,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
  });
  process.exit(result.status ?? 1);
}

const result = spawnSync(process.execPath, nodeArgs, { cwd: backendRoot, stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
