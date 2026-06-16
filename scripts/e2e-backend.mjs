/**
 * Ephemeral SQLite backend for Playwright smoke tests.
 * Uses Electron's Node ABI when available (matches better-sqlite3 build).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const backendRoot = path.join(root, 'backend');
const require = createRequire(import.meta.url);
const dbPath = path.join(os.tmpdir(), `nexor-e2e-${process.pid}.db`);
const installDir = path.join(os.tmpdir(), `nexor-e2e-install-${process.pid}`);

function resolveElectronBinary() {
  try {
    const pkgJson = require.resolve('electron/package.json', { paths: [root] });
    const distDir = path.join(path.dirname(pkgJson), 'dist');
    if (process.platform === 'win32') {
      const exe = path.join(distDir, 'electron.exe');
      if (fs.existsSync(exe)) return exe;
    }
    if (process.platform === 'darwin') {
      const mac = path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
      if (fs.existsSync(mac)) return mac;
    }
    const linux = path.join(distDir, 'electron');
    if (fs.existsSync(linux)) return linux;
  } catch {
    /* fall through */
  }
  return null;
}

function cleanupDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbPath}${suffix}`);
    } catch {
      /* ignore */
    }
  }
}

function cleanupInstallDir() {
  try {
    fs.rmSync(installDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

cleanupDb();
cleanupInstallDir();
fs.mkdirSync(installDir, { recursive: true });

const {
  DATABASE_URL: _databaseUrl,
  USE_POSTGRES: _usePostgres,
  ...processEnv
} = process.env;

const electron = resolveElectronBinary();
const runtime = electron || process.execPath;

const env = {
  ...processEnv,
  DB_ENGINE: 'sqlite',
  SQLITE_PATH: dbPath,
  DATABASE_URL: '',
  USE_POSTGRES: '',
  NEXOR_INSTALL_DIR: installDir,
  PORT: process.env.E2E_BACKEND_PORT || '39081',
  NODE_ENV: 'test',
  ...(electron
    ? { ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' }
    : {}),
};

const child = spawn(runtime, ['src/server.js'], {
  cwd: backendRoot,
  env,
  stdio: 'inherit',
});

function shutdown(signal) {
  child.kill(signal);
  cleanupDb();
  cleanupInstallDir();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
child.on('exit', (code) => {
  cleanupDb();
  cleanupInstallDir();
  process.exit(code ?? 0);
});
