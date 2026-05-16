/**
 * Fail the build if win-unpacked does not contain a working unified SQLite stack.
 * Spawns the packaged Electron binary with ELECTRON_RUN_AS_NODE and probes /api/health.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const unpackRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'release', 'win-unpacked');

const productName = 'NEXOR ERP';
const electronExe = path.join(unpackRoot, `${productName}.exe`);
const serverJs = path.join(unpackRoot, 'resources', 'backend', 'src', 'server.js');
const dbJs = path.join(unpackRoot, 'resources', 'backend', 'src', 'db.js');
const backendRoot = path.join(unpackRoot, 'resources', 'backend');
const sqliteNode = path.join(
  backendRoot,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);

function fail(msg, code = 1) {
  console.error(`[verify-packaged-backend] ${msg}`);
  process.exit(code);
}

if (!fs.existsSync(serverJs)) fail(`Missing packaged server: ${serverJs}`, 2);
if (!fs.existsSync(dbJs)) fail(`Missing packaged db.js: ${dbJs}`, 2);
if (!fs.existsSync(electronExe)) fail(`Missing packaged Electron: ${electronExe}`, 2);
if (!fs.existsSync(sqliteNode)) fail(`Missing better_sqlite3.node — run npm run rebuild:backend`, 2);

const server = fs.readFileSync(serverJs, 'utf8');
const isUnifiedSqlite =
  server.includes('SQLite unified')
  && server.includes("require('./db')")
  && server.includes('/api/products');
if (!isUnifiedSqlite) fail('Packaged server.js is not the unified SQLite stack.');

const db = fs.readFileSync(dbJs, 'utf8');
if (db.includes("require('pg')") || db.includes('require("pg")')) {
  fail('Packaged db.js still requires pg — backend tree is stale.');
}
if (!db.includes('better-sqlite3')) fail('Packaged db.js must use better-sqlite3.');

const testPort = 3199;
const testDb = path.join(root, '.tmp-verify-packaged-backend.db');

function waitForHealth(port, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/health', timeout: 2000 },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let payload = null;
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              payload = null;
            }
            const ok =
              res.statusCode === 200
              && payload?.ok === true
              && payload?.unified === true
              && (payload?.engine === 'sqlite' || payload?.engine === 'postgres');
            if (ok) return resolve({ ok: true, payload });
            if (Date.now() - start > timeoutMs) return resolve({ ok: false, reason: 'invalid-health' });
            setTimeout(tryOnce, 350);
          });
        }
      );
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve({ ok: false, reason: 'unreachable' });
        setTimeout(tryOnce, 350);
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) return resolve({ ok: false, reason: 'timeout' });
        setTimeout(tryOnce, 350);
      });
    };
    tryOnce();
  });
}

try {
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
} catch {
  /* ignore */
}

console.log('[verify-packaged-backend] Smoke test — spawning packaged backend on port', testPort);

let stderr = '';
const child = spawn(electronExe, [serverJs], {
  cwd: backendRoot,
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe'],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    PORT: String(testPort),
    SQLITE_PATH: testDb,
    DATABASE_URL: '',
    DB_ENGINE: 'sqlite',
    NODE_ENV: 'production',
    NODE_PATH: path.join(backendRoot, 'node_modules'),
  },
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8');
});

const health = await waitForHealth(testPort, 22000);

try {
  child.kill('SIGTERM');
} catch {
  /* ignore */
}

setTimeout(() => {
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
}, 1500);

try {
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
} catch {
  /* ignore */
}

if (!health.ok) {
  if (/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|better_sqlite3\.node/i.test(stderr)) {
    fail(
      'better-sqlite3 ABI mismatch in packaged app. '
        + 'Run: npm run rebuild:backend && npm run electron:build '
        + '(afterPack rebuilds native modules for the shipped Electron). '
        + `Details: ${stderr.split('\n').slice(0, 6).join(' ').trim()}`
    );
  }
  fail(
    `Packaged backend did not answer /api/health (${health.reason || 'unknown'}). `
      + (stderr ? `stderr: ${stderr.slice(0, 500)}` : '')
  );
}

console.log(
  '[verify-packaged-backend] OK — unified SQLite backend healthy at',
  serverJs,
  `(engine=${health.payload?.engine})`
);
