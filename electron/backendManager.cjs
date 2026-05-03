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
const HEALTH_TIMEOUT_MS = 4000;         // single-probe timeout
const HEALTH_FAILS_BEFORE_RESTART = 3;  // 3 consecutive misses → restart
const RESTART_BACKOFF_MS = 2000;        // wait between restart attempts
const MAX_RESTART_ATTEMPTS = 3;         // give up after this many in a row

// Phase 6: log retention
const LOG_RETENTION_DAYS = 30;
const LOG_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // sweep every 6h while app runs

let childProc = null;
let boundPort = null;
let lastMode = 'unknown';
let lastDockerOk = false;

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
function resolveBackendEntry() {
  let appPath = null;
  try {
    appPath = app.getAppPath();
  } catch (_) {}

  // extraResources copies backend/ to <resources>/backend/ — that must win in production.
  // (app.asar does not include backend/, so older logic often fell through to dev paths.)
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'backend', 'src', 'server.js') : null,
    path.join(__dirname, '..', 'backend', 'src', 'server.js'),
    appPath ? path.join(appPath, 'backend', 'src', 'server.js') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'src', 'server.js') : null,
  ].filter(Boolean);

  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
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

// --------------------------------------------------------------------------
// 2) Port detection
// --------------------------------------------------------------------------
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
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

// --------------------------------------------------------------------------
// Spawn
// --------------------------------------------------------------------------
function spawnBackend(entryPath, port, sqlitePathOverride = null) {
  const cwd = resolveBackendCwd(entryPath);
  const nodePath = buildBackendNodePath();
  const sqlitePath = sqlitePathOverride || path.join(app.getPath('userData'), 'erp.db');

  // CRITICAL: Always use the Electron executable (never system node).
  // app.getPath('exe') returns the NEXOR ERP.exe path even on Windows
  // where PATH might shadow with system node v24 — that previously caused
  // "Cannot find module 'dotenv'" because system Node can't see the
  // bundled backend node_modules.
  // ELECTRON_RUN_AS_NODE=1 makes the Electron binary behave as a pure
  // Node v20 process (no Chromium), which DOES see the resources tree.
  let runnerExe;
  try {
    runnerExe = app.getPath('exe');
  } catch (_) {
    runnerExe = process.execPath;
  }

  const exeBase = path.basename(runnerExe).toLowerCase();
  const isNodeExe = exeBase === 'node.exe' || exeBase === 'node';
  // In dev, Electron is often launched via a Node CLI shim — getPath('exe') is node.exe.
  // Use that Node to run the backend so better-sqlite3 matches `npm rebuild` in backend/.
  const usePackagedRunner = app.isPackaged;
  if (isNodeExe && usePackagedRunner) {
    const err = `Refusing to spawn backend with system Node (${runnerExe}) in packaged app. Expected Electron exe.`;
    console.error(`[BackendManager] ${err}`);
    throw new Error(err);
  }

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

  const env = {
    ...process.env,
    PORT: String(port),
    SQLITE_PATH: sqlitePath,
    NODE_ENV: process.env.NODE_ENV || 'production',
    NODE_PATH: nodePath,
    ELECTRON_NO_ATTACH_CONSOLE: '1',
  };
  if (isNodeExe) {
    delete env.ELECTRON_RUN_AS_NODE;
  } else {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  delete env.ELECTRON_RUN_AS_NODE_DISABLE_NODE_OPTIONS;

  console.log(
    `[BackendManager] spawning: ${runnerExe} ${entryPath} (cwd=${cwd}, plainNode=${isNodeExe})`
  );
  console.log(`[BackendManager] SQLite file: ${sqlitePath}`);
  const proc = spawn(runnerExe, [entryPath], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', (chunk) => {
    process.stdout.write(`[backend] ${chunk}`);
    writeLog(logStream, 'stdout', chunk);
  });
  proc.stderr.on('data', (chunk) => {
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
  });

  return proc;
}

// Wait until OUR Express answers /api/health (must be SQLite unified — not some other server on the port).
function waitForBackendReady(port, timeoutMs = 15000) {
  const http = require('http');
  const start = Date.now();
  return new Promise((resolve) => {
    const tryOnce = () => {
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
            && payload.engine === 'sqlite'
            && payload.unified === true;
          if (ok) return resolve(true);
          if (Date.now() - start > timeoutMs) return resolve(false);
          setTimeout(tryOnce, 400);
        });
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, 400);
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------
async function start(opts = {}) {
  const mode = opts.mode || 'unknown';
  const sqlitePath = typeof opts.sqlitePath === 'string' && opts.sqlitePath.trim() ? opts.sqlitePath.trim() : null;
  lastMode = mode;

  // Phase 4: client PCs MUST NOT spawn a local Express — they use the server's.
  if (!shouldSpawnForMode(mode)) {
    console.log(`[BackendManager] mode="${mode}" → skipping spawn (client uses remote backend)`);
    return { skipped: true, reason: 'client-mode', mode };
  }

  // Already running in this process?
  if (childProc && boundPort) {
    return { started: true, port: boundPort, mode, alreadyRunning: true };
  }

  // SQLite mode: do not gate backend startup on Docker/PostgreSQL availability.
  lastDockerOk = true;

  // Resolve backend entry
  const entry = resolveBackendEntry();
  if (!entry) {
    const err = 'backend/src/server.js not found in dev tree or packaged resources.';
    console.error(`[BackendManager] ${err}`);
    return { error: err, code: 'BACKEND_NOT_FOUND', mode };
  }

  // Phase 2: pick a free port
  const port = await findFreePort(DEFAULT_PORT, PORT_RANGE);
  if (!port) {
    const err = `No free port in range ${DEFAULT_PORT}..${DEFAULT_PORT + PORT_RANGE - 1}.`;
    console.error(`[BackendManager] ${err}`);
    return { error: err, code: 'NO_FREE_PORT', mode };
  }

  console.log(`[BackendManager] spawning backend on port ${port} (mode=${mode}) entry=${entry}`);
  childProc = spawnBackend(entry, port, sqlitePath);
  boundPort = port;

  // Don't return until /api/health responds (or we time out).
  const ready = await waitForBackendReady(port, 15000);
  if (!ready) {
    console.error('[BackendManager] backend did not become ready within 15s');
    // We keep the child running — the server may still come up shortly. UI
    // will reconnect via its own polling. But surface the warning.
    return { started: true, port, mode, warning: 'backend-not-ready-in-time' };
  }

  console.log(`[BackendManager] backend ready on http://127.0.0.1:${port}`);
  consecutiveFails = 0;
  restartAttempts = 0;
  startHealthMonitor();
  emitStatus({ state: 'healthy', detail: 'Backend ready' });
  return { started: true, port, mode };
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
  };
}

// --------------------------------------------------------------------------
// Phase 5: Health monitor + auto-restart
// --------------------------------------------------------------------------
function probeHealthOnce(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const http = require('http');
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, (res) => {
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
          && payload.engine === 'sqlite'
          && payload.unified === true;
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

  if (consecutiveFails === 1) {
    emitStatus({ state: 'degraded', detail: 'Backend not responding', fails: consecutiveFails });
  } else if (consecutiveFails < HEALTH_FAILS_BEFORE_RESTART) {
    emitStatus({ state: 'degraded', detail: `Health check failed (${consecutiveFails}/${HEALTH_FAILS_BEFORE_RESTART})`, fails: consecutiveFails });
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
