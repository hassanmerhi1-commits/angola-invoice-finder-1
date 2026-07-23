/**
 * NEXOR ERP — Backend Manager (Option A, Phases 1–4)
 *
 * Responsibilities:
 *   1. Spawn the Express backend (backend/src/server.js) as a child process
 *      using Electron's bundled Node runtime, with PORT injected dynamically.
 *   2. Detect a free TCP port (3000 → 3010 fallback) so multiple installs /
 *      stale processes don't collide.
 *   3. Pre-flight Docker PostgreSQL check on localhost:5432 (TCP) before
 *      spawning, so we surface a friendly error instead of an instant crash.
 *   4. Server/Client mode awareness: skip spawn entirely when this PC is a
 *      LAN client (Express lives on the server PC, not here).
 *
 * Exposes:
 *   start(opts) → { skipped|started, port, error? }
 *   stop()      → graceful SIGTERM with hard-kill timeout
 *   getPort()   → currently bound port (or null)
 *   getStatus() → { running, port, mode, dockerOk }
 *
 * NOT included yet (phases 5–7, intentionally deferred):
 *   - Health monitoring + auto-restart
 *   - Rotating log files to %APPDATA%/NEXOR-ERP/logs/
 *   - Code-signing / firewall rule installer
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { app } = require('electron');

const DEFAULT_PORT = 3000;
/** Try 3000..3009 so dev can keep a manual `node backend` on 3000 while Electron still starts. */
const PORT_RANGE = 10;
const DOCKER_HOST = '127.0.0.1';
const DOCKER_PG_PORT = 5432;
const DOCKER_TCP_TIMEOUT = 1500;
const SHUTDOWN_GRACE_MS = 4000;

// Phase 5: health monitor tunables
const HEALTH_INTERVAL_MS = 30000;       // poll cadence
const HEALTH_TIMEOUT_MS = 12000;        // must exceed SQLite busy_timeout (5s) under load
const HEALTH_FAILS_BEFORE_DEGRADED = 2; // avoid false "not responding" during heavy inventory
const HEALTH_FAILS_BEFORE_RESTART = 4;  // consecutive misses → restart
const RESTART_BACKOFF_MS = 2000;        // wait between restart attempts
const MAX_RESTART_ATTEMPTS = 3;         // give up after this many in a row

// Phase 6: log retention
const LOG_RETENTION_DAYS = 30;
const LOG_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // sweep every 6h while app runs

let childProc = null;
let boundPort = null;
let lastMode = 'unknown';
/** Prevents overlapping start() calls (race → EADDRINUSE on port 3000). */
let startPromise = null;
let lastDockerOk = false;
let lastSpawnNativeError = null;

// Phase 5 state
let healthTimer = null;
let consecutiveFails = 0;
let restartAttempts = 0;
let isRestarting = false;
let statusListener = null;          // (status) => void  set by main.cjs
let lastHealthState = null;         // dedupe identical 'healthy' emits

// Phase 6 state
let logDir = null;                  // set by main.cjs via setLogDir()
let logStream = null;               // current day's WriteStream
let logStreamDate = null;           // 'YYYY-MM-DD' the stream was opened for
let logCleanupTimer = null;

function setStatusListener(fn) {
  statusListener = typeof fn === 'function' ? fn : null;
}

function emitStatus(event) {
  // event: { state: 'healthy'|'degraded'|'down'|'restarting'|'restarted'|'failed', detail? }
  const payload = { ...event, port: boundPort, mode: lastMode, ts: Date.now() };
  // Dedupe back-to-back 'healthy' so we don't fire a toast every 30s.
  if (payload.state === 'healthy' && lastHealthState === 'healthy') return;
  lastHealthState = payload.state;
  // Phase 6: persist status events to today's log too.
  try { writeLog(logStream, 'status', Buffer.from(`${payload.state}${payload.detail ? ' — ' + payload.detail : ''}`)); } catch (_) {}
  try { statusListener && statusListener(payload); } catch (_) {}
}

// --------------------------------------------------------------------------
// Phase 6: rotating log files
//   - File: <logDir>/backend-YYYY-MM-DD.log  (one per local-time day)
//   - Both stdout and stderr are tee'd: console (for Electron logs) + file.
//   - Stream is reopened automatically when the date rolls over.
//   - Files older than LOG_RETENTION_DAYS days are deleted on a 6h sweep.
//   - All file I/O is best-effort: a failure to write a log line must NEVER
//     crash the backend lifecycle.
// --------------------------------------------------------------------------
function setLogDir(dir) {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    logDir = dir;
    // Sweep once on init, then on a slow timer.
    sweepOldLogs();
    if (!logCleanupTimer) {
      logCleanupTimer = setInterval(sweepOldLogs, LOG_CLEANUP_INTERVAL_MS);
      if (logCleanupTimer.unref) logCleanupTimer.unref();
    }
    console.log(`[BackendManager] log dir: ${logDir}`);
  } catch (e) {
    console.error('[BackendManager] failed to init log dir:', e?.message || e);
    logDir = null;
  }
}

function getLogDir() {
  return logDir;
}

function todayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ensureLogStream() {
  if (!logDir) return null;
  const stamp = todayStamp();
  if (logStream && logStreamDate === stamp) return logStream;

  // Date rolled or first open — close prior stream and open new.
  if (logStream) {
    try { logStream.end(); } catch (_) {}
    logStream = null;
  }
  try {
    const file = path.join(logDir, `backend-${stamp}.log`);
    logStream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
    logStream.on('error', (err) => {
      console.error('[BackendManager] log stream error:', err?.message || err);
      try { logStream && logStream.end(); } catch (_) {}
      logStream = null;
    });
    logStreamDate = stamp;
    // Header on rollover so the file is self-describing.
    logStream.write(`\n===== NEXOR ERP backend log opened ${new Date().toISOString()} =====\n`);
  } catch (e) {
    console.error('[BackendManager] failed to open log file:', e?.message || e);
    logStream = null;
  }
  return logStream;
}

function writeLog(stream, prefix, chunk) {
  const s = ensureLogStream();
  if (!s) return;
  try {
    const text = chunk.toString('utf8');
    // Prefix every line with a timestamp + stream tag so debugging is sane.
    const ts = new Date().toISOString();
    const lines = text.split(/\r?\n/);
    // Drop the trailing empty string from a final newline so we don't write blank lines.
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      s.write(`${ts} [${prefix}] ${line}\n`);
    }
  } catch (_) { /* swallow */ }
}

function sweepOldLogs() {
  if (!logDir) return;
  fs.readdir(logDir, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of files) {
      // Only touch our own files; never wipe foreign content.
      const m = /^backend-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name);
      if (!m) continue;
      const fileDate = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
      if (Number.isFinite(fileDate) && fileDate < cutoff) {
        fs.unlink(path.join(logDir, name), () => {});
      }
    }
  });
}

function closeLogStream() {
  if (logStream) {
    try { logStream.end(); } catch (_) {}
    logStream = null;
    logStreamDate = null;
  }
  if (logCleanupTimer) {
    clearInterval(logCleanupTimer);
    logCleanupTimer = null;
  }
}

// --------------------------------------------------------------------------
// Path resolution: backend lives next to electron/ in dev, and is shipped via
// extraResources (electron-builder.json) in production at:
//   <resourcesPath>/backend/src/server.js
// --------------------------------------------------------------------------
function isViableBackendEntry(entryPath) {
  try {
    const cwd = resolveBackendCwd(entryPath);
    const required = [
      path.join(cwd, 'node_modules', 'dotenv'),
      path.join(cwd, 'src', 'lib', 'sqlDialect.js'),
      path.join(cwd, 'scripts', 'lib', 'integrityRunner.js'),
    ];
    return required.every((p) => fs.existsSync(p));
  } catch (_) {
    return false;
  }
}

/** Parse semver-ish "1.1.54" → [1,1,54] for comparison. */
function parseVersionParts(version) {
  const parts = String(version || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n));
  return parts.length ? parts : [0];
}

function compareVersionStrings(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** package.json version for a backend tree (installer vs C:\NEXOR ERP overlay). */
function readBackendPackageVersion(entryPath) {
  try {
    const pkgPath = path.join(resolveBackendCwd(entryPath), 'package.json');
    if (!fs.existsSync(pkgPath)) return '0.0.0';
    const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    return version && version !== '1.0.0' ? String(version) : '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

/**
 * Schema expectation for a backend tree.
 * Prefer scanning migrations/*.sql so we never depend on a hand-bumped constant.
 */
function readBackendSchemaExpectation(entryPath) {
  try {
    const cwd = resolveBackendCwd(entryPath);
    const migDir = path.join(cwd, 'src', 'migrations');
    if (fs.existsSync(migDir)) {
      let max = 0;
      for (const name of fs.readdirSync(migDir)) {
        const match = name.match(/^(\d+)_/);
        if (match) max = Math.max(max, Number(match[1]));
      }
      if (max > 0) return max;
    }
    const statusFile = path.join(cwd, 'src', 'lib', 'deploymentStatus.js');
    if (!fs.existsSync(statusFile)) return 0;
    const text = fs.readFileSync(statusFile, 'utf8');
    const match = text.match(/EXPECTED_SCHEMA_VERSION\s*=\s*(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch (_) {
    return 0;
  }
}

/** Feature markers — higher score = newer backend (independent of shell app version). */
function readBackendFeatureScore(entryPath) {
  try {
    const cwd = resolveBackendCwd(entryPath);
    let score = 0;
    if (fs.existsSync(path.join(cwd, 'src', 'lib', 'certificationDemoProfile.js'))) score += 100;
    if (fs.existsSync(path.join(cwd, 'src', 'lib', 'pgSavepoint.js'))) score += 40;
    if (fs.existsSync(path.join(cwd, 'src', 'lib', 'trackFirstSqlError.js'))) score += 20;
    const certRoute = path.join(cwd, 'src', 'routes', 'certification.js');
    if (fs.existsSync(certRoute)) {
      const text = fs.readFileSync(certRoute, 'utf8');
      if (text.includes('apply-demo-profile')) score += 50;
      if (text.includes('applyCertificationDemoProfile')) score += 25;
    }
    return score;
  } catch (_) {
    return 0;
  }
}

function compareBackendCandidates(a, b, packagedPath, installPath) {
  // 1) Real release version wins — stops an old C:\NEXOR ERP\backend overlay
  //    from shadowing a freshly installed Program Files backend.
  const versionCmp = compareVersionStrings(
    readBackendPackageVersion(a),
    readBackendPackageVersion(b),
  );
  if (versionCmp !== 0) return versionCmp;

  const schemaA = readBackendSchemaExpectation(a);
  const schemaB = readBackendSchemaExpectation(b);
  if (schemaA !== schemaB) return schemaB - schemaA;

  const featureA = readBackendFeatureScore(a);
  const featureB = readBackendFeatureScore(b);
  if (featureA !== featureB) return featureB - featureA;

  if (!process.env.ELECTRON_DEV && process.env.NODE_ENV !== 'development') {
    const aIsPackaged = packagedPath && path.normalize(a) === path.normalize(packagedPath);
    const bIsPackaged = packagedPath && path.normalize(b) === path.normalize(packagedPath);
    if (aIsPackaged && !bIsPackaged) return -1;
    if (bIsPackaged && !aIsPackaged) return 1;
  }

  return 0;
}

function resolveBackendEntry() {
  let appPath = null;
  try {
    appPath = app.getAppPath();
  } catch (_) {}

  const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
  const entryOverride = process.env.NEXOR_BACKEND_ENTRY;
  const isDev =
    process.env.ELECTRON_DEV === 'true'
    || process.env.NODE_ENV === 'development';

  const repoBackend = path.join(__dirname, '..', 'backend', 'src', 'server.js');
  const installBackend = path.join(installDir, 'backend', 'src', 'server.js');
  const packagedBackend = process.resourcesPath
    ? path.join(process.resourcesPath, 'backend', 'src', 'server.js')
    : null;
  const unpackedBackend = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'src', 'server.js')
    : null;

  // Release: packaged installer backend first (matches UI version), then C:\NEXOR ERP sync overlay.
  const candidates = isDev
    ? [
      entryOverride || null,
      repoBackend,
      installBackend,
      packagedBackend,
      appPath ? path.join(appPath, 'backend', 'src', 'server.js') : null,
      unpackedBackend,
    ]
    : [
      entryOverride || null,
      packagedBackend,
      installBackend,
      unpackedBackend,
      repoBackend,
      appPath ? path.join(appPath, 'backend', 'src', 'server.js') : null,
    ];

  const viable = [];
  for (const p of candidates.filter(Boolean)) {
    try {
      if (fs.existsSync(p) && isViableBackendEntry(p)) {
        viable.push(p);
      } else if (fs.existsSync(p)) {
        console.warn(`[BackendManager] skipping incomplete backend at ${p}`);
      }
    } catch (_) {}
  }

  if (viable.length === 0) return null;

  // In development the working tree is the source of truth. An installed sync
  // overlay (e.g. C:\NEXOR ERP\backend) can advertise an equal/higher schema or
  // feature score and silently shadow local edits — which makes code changes
  // appear to have no effect. Always prefer the repo backend in dev unless an
  // explicit NEXOR_BACKEND_ENTRY override is set.
  if (isDev && !entryOverride) {
    const repoViable = viable.find(
      (p) => path.normalize(p) === path.normalize(repoBackend),
    );
    if (repoViable) {
      console.log(`[BackendManager] dev mode: using repo backend ${repoViable}`);
      return repoViable;
    }
  }

  const packagedPath = packagedBackend && fs.existsSync(packagedBackend) ? packagedBackend : null;
  const installPath = installBackend && fs.existsSync(installBackend) ? installBackend : null;

  let best = viable[0];
  for (let i = 1; i < viable.length; i++) {
    const candidate = viable[i];
    if (compareBackendCandidates(best, candidate, packagedPath, installPath) > 0) {
      best = candidate;
    }
  }

  if (viable.length > 1) {
    const skipped = viable.filter((p) => p !== best);
    for (const p of skipped) {
      const schema = readBackendSchemaExpectation(p);
      const features = readBackendFeatureScore(p);
      if (schema < readBackendSchemaExpectation(best) || features < readBackendFeatureScore(best)) {
        console.warn(
          `[BackendManager] ignoring older backend at ${p} (schema ${schema}, features ${features}); `
            + `using ${best} (schema ${readBackendSchemaExpectation(best)}, features ${readBackendFeatureScore(best)})`,
        );
      }
    }
  }

  console.log(
    `[BackendManager] using backend entry: ${best} `
    + `(v${readBackendPackageVersion(best)}, schema ${readBackendSchemaExpectation(best)}, `
    + `features ${readBackendFeatureScore(best)})`,
  );
  if (
    installPath
    && packagedPath
    && path.normalize(best) === path.normalize(packagedPath)
    && fs.existsSync(installPath)
  ) {
    const installVer = readBackendPackageVersion(installPath);
    const packagedVer = readBackendPackageVersion(packagedPath);
    if (compareVersionStrings(packagedVer, installVer) > 0) {
      console.warn(
        `[BackendManager] C:\\NEXOR ERP\\backend is older (v${installVer}) than the installed app `
        + `(v${packagedVer}). Using Program Files backend. Re-run sync-nexor-backend.ps1 on the `
        + 'SERVER only if you intentionally maintain a sync overlay.',
      );
    }
  }
  return best;
}

function resolveBackendCwd(entryPath) {
  // server.js sits at backend/src/server.js → cwd should be backend/
  return path.resolve(path.dirname(entryPath), '..');
}

function buildBackendNodePath() {
  const candidates = [
    process.env.NODE_PATH,
    process.resourcesPath ? path.join(process.resourcesPath, 'runtime-deps', 'node_modules') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'node_modules') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'node_modules') : null,
    path.join(__dirname, '..', 'node_modules'),
  ].filter(Boolean);

  return Array.from(new Set(candidates)).join(path.delimiter);
}

/** npm `electron` package — same binary this app uses; required for ELECTRON_RUN_AS_NODE + native ABI. */
function resolveElectronDistBinaryFromProject() {
  try {
    const pkgJson = require.resolve('electron/package.json', { paths: [path.join(__dirname, '..')] });
    const electronRoot = path.dirname(pkgJson);
    const dist = path.join(electronRoot, 'dist');
    let candidate = null;
    if (process.platform === 'win32') {
      candidate = path.join(dist, 'electron.exe');
    } else if (process.platform === 'darwin') {
      candidate = path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
    } else {
      candidate = path.join(dist, 'electron');
    }
    if (candidate && fs.existsSync(candidate)) return candidate;
  } catch (e) {
    console.warn('[BackendManager] could not resolve node_modules/electron dist:', e?.message || e);
  }
  return null;
}

function isNodeExecutable(filePath) {
  if (!filePath) return false;
  const b = path.basename(filePath).toLowerCase();
  return b === 'node.exe' || b === 'node';
}

function isLikelyElectronExecutable(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const b = path.basename(filePath).toLowerCase();
  if (process.platform === 'win32') return b === 'electron.exe';
  if (process.platform === 'darwin') {
    // Real app is always under …/Electron.app/Contents/MacOS/Electron; CLI shims may be named "electron".
    return filePath.includes('Electron.app') || b === 'electron';
  }
  return b === 'electron';
}

/**
 * Embedded backend loads `better-sqlite3` from backend/node_modules.
 * `npm run rebuild:backend` runs @electron/rebuild → native targets **Electron's** NODE_MODULE_VERSION.
 * Spawning with plain `node.exe` while getPath('exe') is Node breaks SQLite init → Express never listens.
 */
function resolveEmbeddedBackendRunner() {
  const fromOverride = process.env.NEXOR_EMBEDDED_NODE_EXE;
  if (fromOverride && fs.existsSync(fromOverride)) {
    return { runner: fromOverride, electronRunAsNode: true, source: 'NEXOR_EMBEDDED_NODE_EXE' };
  }

  let getPathExe = null;
  try {
    getPathExe = app.getPath('exe');
  } catch (_) {}

  if (app.isPackaged) {
    const runner = getPathExe || process.execPath;
    if (isNodeExecutable(runner)) {
      throw new Error(
        `Packaged app executable is Node (${runner}) — expected the real app .exe. Cannot start embedded backend.`
      );
    }
    return { runner, electronRunAsNode: true, source: 'packaged-app-exe' };
  }

  const distBinary = resolveElectronDistBinaryFromProject();
  const candidates = [getPathExe, distBinary, process.execPath].filter(Boolean);
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (!fs.existsSync(candidate)) continue;
    if (isNodeExecutable(candidate)) continue;
    if (isLikelyElectronExecutable(candidate)) {
      return { runner: candidate, electronRunAsNode: true, source: path.basename(candidate) };
    }
  }

  if (distBinary && fs.existsSync(distBinary)) {
    return { runner: distBinary, electronRunAsNode: true, source: 'node_modules/electron/dist' };
  }

  const fallback = process.execPath;
  console.warn(
    '[BackendManager] Using Node to run embedded backend (no Electron dist found). '
      + 'If saves fail, run: cd backend && npm rebuild better-sqlite3 — '
      + 'or install devDependency `electron` and use npm run rebuild:backend.'
  );
  return { runner: fallback, electronRunAsNode: false, source: 'node-fallback' };
}

// --------------------------------------------------------------------------
// 2) Port detection
// --------------------------------------------------------------------------
function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 500 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (err) => {
      socket.destroy();
      resolve(err?.code === 'ECONNREFUSED' || err?.code === 'ECONNRESET');
    });
  });
}

async function findFreePort(start = DEFAULT_PORT, range = PORT_RANGE) {
  for (let i = 0; i < range; i++) {
    const candidate = start + i;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(candidate)) return candidate;
  }
  return null;
}

// --------------------------------------------------------------------------
// 3) Docker pre-flight (cheap TCP probe, no pg dependency required)
// --------------------------------------------------------------------------
function probeDockerPostgres(host = DOCKER_HOST, port = DOCKER_PG_PORT, timeoutMs = DOCKER_TCP_TIMEOUT) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    try { socket.connect(port, host); } catch (_) { done(false); }
  });
}

// --------------------------------------------------------------------------
// 4) Mode detection — defer to caller (it owns IP-file parsing).
//    We accept a mode hint: 'server' | 'client' | 'standalone' | 'unknown'.
//    Only 'server' and 'standalone' should spawn Express here.
// --------------------------------------------------------------------------
function shouldSpawnForMode(mode) {
  return mode === 'server' || mode === 'standalone' || mode === 'unknown';
}

function noteSpawnNativeError(chunk) {
  const text = chunk.toString('utf8');
  if (/Cannot find module/i.test(text)) {
    lastSpawnNativeError =
      'Backend dependencies are missing. Run scripts/sync-nexor-backend.ps1 from the repo, '
      + 'or "npm install" in C:\\NEXOR ERP\\backend, then restart NEXOR.';
    console.error(`[BackendManager] ${lastSpawnNativeError}`);
    console.error('[BackendManager]', text.trim().split('\n').slice(0, 6).join('\n'));
    return;
  }
  if (!/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|better_sqlite3\.node/i.test(text)) return;
  lastSpawnNativeError =
    'SQLite native module (better-sqlite3) does not match this app\'s Electron version. '
    + 'Dev: run "npm run rebuild:backend" then restart. Installed .exe: run "npm run electron:build" and reinstall.';
  console.error(`[BackendManager] ${lastSpawnNativeError}`);
  console.error('[BackendManager]', text.trim().split('\n').slice(0, 8).join('\n'));
}

// --------------------------------------------------------------------------
// Spawn
// --------------------------------------------------------------------------
function spawnBackend(entryPath, port, sqlitePathOverride = null) {
  lastSpawnNativeError = null;
  const cwd = resolveBackendCwd(entryPath);
  const nodePathExtra = buildBackendNodePath();
  const cwdNodeModules = path.join(cwd, 'node_modules');
  const nodePath = [cwdNodeModules, nodePathExtra].filter(Boolean).join(path.delimiter);
  let sqlitePath = sqlitePathOverride || path.join(app.getPath('userData'), 'erp.db');
  try {
    const sqliteDir = path.dirname(sqlitePath);
    if (!fs.existsSync(sqliteDir)) fs.mkdirSync(sqliteDir, { recursive: true });
  } catch (e) {
    console.warn('[BackendManager] SQLite directory:', e?.message || e);
  }

  const { runner: runnerExe, electronRunAsNode, source: runnerSource } = resolveEmbeddedBackendRunner();

  // Verify the backend's own node_modules made it into the install.
  // If dotenv isn't there, the installer was built without bundling
  // backend/node_modules — give a clear error instead of a confusing
  // MODULE_NOT_FOUND deep in server.js.
  const dotenvPath = path.join(cwd, 'node_modules', 'dotenv');
  if (!fs.existsSync(dotenvPath)) {
    const err = `backend/node_modules is missing from this install (looked in ${cwd}). Rebuild the installer with backend/node_modules bundled.`;
    console.error(`[BackendManager] ${err}`);
    throw new Error(err);
  }

  const { resolveInstallDatabaseMode } = require('./databaseConfig.cjs');
  const dbMode = resolveInstallDatabaseMode();
  const usePostgres = dbMode.engine === 'postgres' && !!dbMode.databaseUrl && !dbMode.forceSqlite;

  let nexorAppVersion = process.env.NEXOR_APP_VERSION || '';
  if (!nexorAppVersion) {
    try {
      const rootPkg = path.join(app.getAppPath(), 'package.json');
      if (fs.existsSync(rootPkg)) {
        nexorAppVersion = JSON.parse(fs.readFileSync(rootPkg, 'utf8')).version || '';
      }
    } catch (_) {}
  }

  const env = {
    ...process.env,
    PORT: String(port),
    NEXOR_INSTALL_DIR: process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP',
    NEXOR_IP_FILE: process.env.NEXOR_IP_FILE || 'C:\\NEXOR ERP\\IP',
    NODE_ENV: process.env.NODE_ENV || 'production',
    NODE_PATH: nodePath,
    ELECTRON_NO_ATTACH_CONSOLE: '1',
  };
  if (nexorAppVersion) {
    env.NEXOR_APP_VERSION = nexorAppVersion;
  }
  env.NEXOR_BACKEND_ENTRY = entryPath;

  if (usePostgres) {
    env.DATABASE_URL = dbMode.databaseUrl;
    env.DB_ENGINE = 'postgres';
    delete env.SQLITE_PATH;
    console.log('[BackendManager] PostgreSQL mode (database.env)');
  } else {
    const resolvedSqlite = dbMode.forceSqlite && dbMode.sqlitePath
      ? dbMode.sqlitePath
      : sqlitePath;
    env.SQLITE_PATH = resolvedSqlite;
    env.DATABASE_URL = '';
    env.DB_ENGINE = 'sqlite';
    console.log(`[BackendManager] SQLite file: ${resolvedSqlite}`);
  }
  if (electronRunAsNode) {
    env.ELECTRON_RUN_AS_NODE = '1';
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }
  delete env.ELECTRON_RUN_AS_NODE_DISABLE_NODE_OPTIONS;

  console.log(
    `[BackendManager] spawning: ${runnerExe} ${entryPath} (cwd=${cwd}, runner=${runnerSource}, ELECTRON_RUN_AS_NODE=${electronRunAsNode ? '1' : 'off'})`
  );
  const proc = spawn(runnerExe, [entryPath], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.on('error', (err) => {
    console.error('[BackendManager] spawn error:', err?.message || err);
    writeLog(logStream, 'spawn-error', Buffer.from(String(err?.message || err)));
  });

  proc.stdout.on('data', (chunk) => {
    process.stdout.write(`[backend] ${chunk}`);
    writeLog(logStream, 'stdout', chunk);
  });
  proc.stderr.on('data', (chunk) => {
    noteSpawnNativeError(chunk);
    process.stderr.write(`[backend!] ${chunk}`);
    writeLog(logStream, 'stderr', chunk);
  });
  proc.on('exit', (code, signal) => {
    const msg = `[BackendManager] child exited code=${code} signal=${signal}`;
    console.log(msg);
    writeLog(logStream, 'lifecycle', Buffer.from(msg));
    if (childProc === proc) {
      childProc = null;
      boundPort = null;
    }
    if (code !== 0 && lastSpawnNativeError) {
      emitStatus({ state: 'failed', detail: lastSpawnNativeError, code: 'SQLITE_NATIVE_MISMATCH' });
    }
  });

  return proc;
}

// Wait until OUR Express answers /api/health (must be SQLite unified — not some other server on the port).
function waitForBackendReady(port, timeoutMs = 15000, proc = null) {
  const http = require('http');
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      resolve(ready);
    };

    const onChildExit = (code, signal) => {
      if (code === 0 && !signal) return;
      const detail = lastSpawnNativeError || `backend exited code=${code} signal=${signal}`;
      console.error(`[BackendManager] backend died before ready on port ${port}: ${detail}`);
      finish(false);
    };

    if (proc) {
      proc.once('exit', onChildExit);
    }

    const tryOnce = () => {
      if (settled) return;
      if (proc && proc.exitCode != null) {
        finish(false);
        return;
      }
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let payload = null;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch (_) {
            payload = null;
          }
          const ok =
            res.statusCode === 200
            && payload
            && payload.ok === true
            && payload.unified === true
            && (payload.engine === 'sqlite' || payload.engine === 'postgres');
          if (ok) return finish(true);
          if (Date.now() - start > timeoutMs) return finish(false);
          setTimeout(tryOnce, 400);
        });
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return finish(false);
        setTimeout(tryOnce, 400);
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) return finish(false);
        setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------
async function stopChildOnly() {
  if (!childProc) {
    boundPort = null;
    return;
  }
  try {
    await stop();
  } catch (e) {
    console.warn('[BackendManager] stopChildOnly:', e?.message || e);
    childProc = null;
    boundPort = null;
  }
}

async function startOnce(opts = {}) {
  const mode = opts.mode || 'unknown';
  const sqlitePath = typeof opts.sqlitePath === 'string' && opts.sqlitePath.trim() ? opts.sqlitePath.trim() : null;
  lastMode = mode;

  // Phase 4: client PCs MUST NOT spawn a local Express — they use the server's.
  if (!shouldSpawnForMode(mode)) {
    console.log(`[BackendManager] mode="${mode}" → skipping spawn (client uses remote backend)`);
    return { skipped: true, reason: 'client-mode', mode };
  }

  // Already running and healthy?
  if (childProc && boundPort) {
    const stillOk = await probeHealthOnce(boundPort, HEALTH_TIMEOUT_MS);
    if (stillOk) {
      return { started: true, port: boundPort, mode, alreadyRunning: true };
    }
    console.warn(`[BackendManager] stale child on port ${boundPort} — respawning`);
    await stopChildOnly();
  }

  lastDockerOk = true;

  const entry = resolveBackendEntry();
  if (!entry) {
    const err = 'backend/src/server.js not found in dev tree or packaged resources.';
    console.error(`[BackendManager] ${err}`);
    return { error: err, code: 'BACKEND_NOT_FOUND', mode };
  }

  const readyTimeout = app.isPackaged ? 45000 : 20000;
  let lastWarning = '';

  for (let i = 0; i < PORT_RANGE; i++) {
    const port = DEFAULT_PORT + i;
    // eslint-disable-next-line no-await-in-loop
    if (!(await isPortFree(port))) {
      console.warn(`[BackendManager] port ${port} busy — trying next`);
      continue;
    }

    console.log(`[BackendManager] spawning backend on port ${port} (mode=${mode}) entry=${entry}`);
    let proc;
    try {
      proc = spawnBackend(entry, port, sqlitePath);
    } catch (e) {
      console.error('[BackendManager] spawn failed:', e?.message || e);
      return { error: String(e?.message || e), code: 'SPAWN_FAILED', mode };
    }
    childProc = proc;
    boundPort = port;

    // eslint-disable-next-line no-await-in-loop
    const ready = await waitForBackendReady(port, readyTimeout, proc);
    if (ready) {
      console.log(`[BackendManager] backend ready on http://127.0.0.1:${port}`);
      consecutiveFails = 0;
      restartAttempts = 0;
      startHealthMonitor();
      emitStatus({ state: 'healthy', detail: 'Backend ready' });
      return { started: true, port, mode };
    }

    lastWarning = lastSpawnNativeError || 'backend-not-ready-in-time';
    console.error(`[BackendManager] port ${port} not ready (${lastWarning}) — retrying`);
    // eslint-disable-next-line no-await-in-loop
    await stopChildOnly();
    await new Promise((r) => setTimeout(r, 400));
  }

  const err = lastSpawnNativeError
    || `Embedded backend did not start on ports ${DEFAULT_PORT}..${DEFAULT_PORT + PORT_RANGE - 1}. ${lastWarning}`;
  if (lastSpawnNativeError) {
    emitStatus({ state: 'failed', detail: lastSpawnNativeError, code: 'SQLITE_NATIVE_MISMATCH' });
  } else {
    emitStatus({ state: 'failed', detail: err });
  }
  return { error: err, code: lastSpawnNativeError ? 'SQLITE_NATIVE_MISMATCH' : 'BACKEND_NOT_READY', mode };
}

async function start(opts = {}) {
  if (startPromise) return startPromise;
  startPromise = startOnce(opts).finally(() => {
    startPromise = null;
  });
  return startPromise;
}

async function stop() {
  stopHealthMonitor();
  if (!childProc) return { stopped: true, alreadyStopped: true };
  const proc = childProc;
  childProc = null;
  const port = boundPort;
  boundPort = null;

  return new Promise((resolve) => {
    let done = false;
    const finish = (how) => {
      if (done) return;
      done = true;
      console.log(`[BackendManager] backend stopped (${how}) port=${port}`);
      resolve({ stopped: true, port });
    };

    proc.once('exit', () => finish('exit'));

    try { proc.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => {
      if (done) return;
      try { proc.kill('SIGKILL'); } catch (_) {}
      finish('sigkill');
    }, SHUTDOWN_GRACE_MS);
  });
}

function getPort() {
  return boundPort;
}

function getStatus() {
  return {
    running: !!childProc,
    port: boundPort,
    mode: lastMode,
    dockerOk: lastDockerOk,
    nativeError: lastSpawnNativeError,
  };
}

// --------------------------------------------------------------------------
// Phase 5: Health monitor + auto-restart
// --------------------------------------------------------------------------
function probeHealthOnce(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const http = require('http');
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health?lite=1', timeout: timeoutMs },
      (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let payload = null;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (_) {
          payload = null;
        }
        const ok =
          res.statusCode === 200
          && payload
          && payload.ok === true
          && payload.unified === true
          && (payload.engine === 'sqlite' || payload.engine === 'postgres');
        resolve(ok);
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function startHealthMonitor() {
  stopHealthMonitor();
  if (!shouldSpawnForMode(lastMode)) return; // client mode polls remote separately
  healthTimer = setInterval(runHealthCheck, HEALTH_INTERVAL_MS);
}

function stopHealthMonitor() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}

async function runHealthCheck() {
  if (isRestarting) return;
  const port = boundPort;
  const ok = await probeHealthOnce(port);

  if (ok) {
    if (consecutiveFails > 0) {
      console.log('[BackendManager] health recovered after', consecutiveFails, 'misses');
      emitStatus({ state: 'healthy', detail: 'Backend reconnected' });
    } else {
      emitStatus({ state: 'healthy' });
    }
    consecutiveFails = 0;
    restartAttempts = 0;
    return;
  }

  consecutiveFails += 1;
  console.warn(`[BackendManager] health probe FAILED (${consecutiveFails}/${HEALTH_FAILS_BEFORE_RESTART}) port=${port}`);

  if (consecutiveFails < HEALTH_FAILS_BEFORE_DEGRADED) {
    // Silent miss — inventory/DB can block briefly without alarming the user.
  } else if (consecutiveFails < HEALTH_FAILS_BEFORE_RESTART) {
    emitStatus({
      state: 'degraded',
      detail:
        consecutiveFails === HEALTH_FAILS_BEFORE_DEGRADED
          ? 'Backend busy — retrying'
          : `Health check failed (${consecutiveFails}/${HEALTH_FAILS_BEFORE_RESTART})`,
      fails: consecutiveFails,
    });
  } else {
    await attemptRestart('health-check-failed');
  }
}

async function attemptRestart(reason) {
  if (isRestarting) return;
  isRestarting = true;
  restartAttempts += 1;

  if (restartAttempts > MAX_RESTART_ATTEMPTS) {
    console.error(`[BackendManager] giving up after ${MAX_RESTART_ATTEMPTS} restart attempts (${reason})`);
    emitStatus({ state: 'failed', detail: `Backend unrecoverable after ${MAX_RESTART_ATTEMPTS} restart attempts`, attempts: restartAttempts });
    isRestarting = false;
    stopHealthMonitor();
    return;
  }

  console.warn(`[BackendManager] restarting backend (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}, reason=${reason})`);
  emitStatus({ state: 'restarting', detail: `Restarting backend (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})`, attempts: restartAttempts });

  const previousMode = lastMode;
  try { await stop(); } catch (e) { console.error('[BackendManager] stop during restart failed:', e); }
  await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));

  // start() will re-init everything (port, docker check, ready wait) and reset counters on success.
  const result = await start({ mode: previousMode });
  isRestarting = false;

  if (result?.started) {
    consecutiveFails = 0;
    emitStatus({ state: 'restarted', detail: 'Backend restarted successfully', port: result.port });
  } else {
    const detail = result?.error || result?.reason || 'Restart failed';
    emitStatus({ state: 'down', detail, code: result?.code });
    // Schedule another attempt via the next health tick (monitor restarted by start()).
    if (!healthTimer) {
      // start() failed → it didn't arm the monitor. Re-arm a slow retry.
      healthTimer = setInterval(runHealthCheck, HEALTH_INTERVAL_MS);
    }
  }
}

module.exports = {
  start, stop, getPort, getStatus,
  probeDockerPostgres, findFreePort,
  setStatusListener,
  // Phase 6
  setLogDir, getLogDir, closeLogStream,
};
