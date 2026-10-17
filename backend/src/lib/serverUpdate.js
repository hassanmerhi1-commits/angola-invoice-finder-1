/**
 * In-app city-server update. Version stays 1.3.8 (AGT); we compare buildId.
 *
 * Safety: admin_settings + PostgreSQL + Windows service only. SHA-512 of the
 * zip, allowlisted paths, backup, migrate, health, rollback. The HTTP handler
 * never restarts itself — a detached PowerShell script does that.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PRODUCT = 'nexor-erp';
const MANIFEST_SCHEMA = 1;
const ALLOWED_APP_VERSION = '1.3.8';
const MAX_PACK_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120000;
const FETCH_TIMEOUT_MS = 20000;
const LOCK_STALE_MS = 20 * 60 * 1000;
const DEFAULT_TAG = 'v1.3.8';
const DEFAULT_REPO = 'hassanmerhi1-commits/angola-invoice-finder-1';
const USER_AGENT = 'NEXOR-ERP-ServerUpdate/1.3.8';

const ALLOWED_REL_EXACT = new Set([
  'manifest.json',
  'backend/package.json',
  'backend/package-lock.json',
  'backend/BUILD_STAMP.json',
  'backend/scripts/ensure-server-schema.js',
  'scripts/apply-nexor-server-update.ps1',
]);

const ALLOWED_REL_PREFIXES = ['webapp/', 'backend/src/'];

const ALLOWED_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.sql', '.json', '.html', '.css',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.map', '.txt', '.md', '.ps1',
]);

const FORBIDDEN_BASENAMES = new Set([
  '.env', '.env.local', '.env.production', 'database.env', 'ip',
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.msi', '.dll', '.node', '.pfx', '.pem', '.key', '.p12', '.env',
]);

function backendRootFromLib() {
  return path.resolve(__dirname, '..', '..');
}

function repoRootFromLib() {
  return path.resolve(backendRootFromLib(), '..');
}

function installDir() {
  return process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
}

function updatesDir() {
  return path.join(installDir(), 'updates');
}

function statusFilePath() {
  return path.join(updatesDir(), 'status.json');
}

function lockFilePath() {
  return path.join(updatesDir(), 'apply.lock');
}

function currentStampPath() {
  return path.join(updatesDir(), 'current.json');
}

function normalizeRel(rel) {
  return String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isForbiddenName(name) {
  const base = path.basename(String(name || '')).toLowerCase();
  if (FORBIDDEN_BASENAMES.has(base)) return true;
  const ext = path.extname(base);
  return FORBIDDEN_EXTENSIONS.has(ext);
}

function assertSafeRelPath(rel) {
  const n = normalizeRel(rel);
  if (!n) throw new Error('Empty update path');
  if (n.includes('\0')) throw new Error('Invalid update path');
  if (path.isAbsolute(n) || /^[a-zA-Z]:/.test(n)) {
    throw new Error(`Absolute path is not allowed: ${n}`);
  }
  const parts = n.split('/');
  if (parts.some((p) => p === '..' || p === '')) {
    throw new Error(`Unsafe update path: ${n}`);
  }
  if (isForbiddenName(n)) {
    throw new Error(`Forbidden file in update pack: ${n}`);
  }
  if (ALLOWED_REL_EXACT.has(n)) return n;
  const allowedPrefix = ALLOWED_REL_PREFIXES.some((pre) => n.startsWith(pre));
  if (!allowedPrefix) {
    throw new Error(`Path is not in the update allowlist: ${n}`);
  }
  const ext = path.extname(n).toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File type is not allowed in update pack: ${n}`);
  }
  return n;
}

function validateManifest(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Manifest must be an object'] };
  }
  if (Number(raw.schema) !== MANIFEST_SCHEMA) {
    errors.push(`Unsupported manifest schema ${raw.schema}`);
  }
  if (String(raw.product || '') !== PRODUCT) {
    errors.push('Manifest product is not nexor-erp');
  }
  if (String(raw.appVersion || '') !== ALLOWED_APP_VERSION) {
    errors.push(`Refusing pack: appVersion must stay ${ALLOWED_APP_VERSION} (AGT)`);
  }
  const buildId = String(raw.buildId || '').trim();
  if (!/^[0-9a-f]{7,64}$/i.test(buildId)) {
    errors.push('Manifest is missing a valid buildId');
  }
  const sha512 = String(raw.sha512 || '').trim().toLowerCase();
  if (sha512 && !/^[0-9a-f]{128}$/.test(sha512)) {
    errors.push('Manifest sha512 must be 128 hex characters');
  }
  const file = String(raw.file || 'nexor-server-update.zip');
  if (file.includes('/') || file.includes('\\') || file.includes('..')) {
    errors.push('Manifest file name is unsafe');
  }
  return {
    ok: errors.length === 0,
    errors,
    manifest: errors.length === 0
      ? {
        schema: MANIFEST_SCHEMA,
        product: PRODUCT,
        appVersion: ALLOWED_APP_VERSION,
        buildId,
        buildIdShort: buildId.slice(0, 7),
        builtAt: raw.builtAt ? String(raw.builtAt) : null,
        file,
        sha512,
        size: Number(raw.size) || null,
        url: raw.url ? String(raw.url) : null,
      }
      : null,
  };
}

function isSameBuild(currentId, latestId) {
  const a = String(currentId || '').trim().toLowerCase();
  const b = String(latestId || '').trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return a.slice(0, 7) === b.slice(0, 7);
  return false;
}

function sha512FileHex(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha512FileHexStreaming(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function readBuildStampFiles() {
  const candidates = [
    path.join(backendRootFromLib(), 'BUILD_STAMP.json'),
    path.join(backendRootFromLib(), 'webapp', 'build.json'),
    currentStampPath(),
  ];
  for (const filePath of candidates) {
    const json = readJsonIfExists(filePath);
    const commit = String(json?.commit || json?.buildId || '').trim();
    if (commit) {
      return {
        commit,
        builtAt: json.builtAt || json.appliedAt || null,
        source: filePath,
      };
    }
  }
  return null;
}

function readStatus() {
  return readJsonIfExists(statusFilePath());
}

function writeStatus(patch) {
  const prev = readStatus() || {};
  const next = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(statusFilePath(), next);
  return next;
}

function readLock() {
  return readJsonIfExists(lockFilePath());
}

function lockIsActive(lock) {
  if (!lock || !lock.at) return false;
  const age = Date.now() - new Date(lock.at).getTime();
  if (!Number.isFinite(age) || age > LOCK_STALE_MS) return false;
  const phase = String(readStatus()?.phase || '');
  if (['downloading', 'verifying', 'applying', 'restarting'].includes(phase)) return true;
  if (lock.pid && lock.pid === process.pid) return true;
  return age < 2 * 60 * 1000;
}

function acquireLock(owner) {
  fs.mkdirSync(updatesDir(), { recursive: true });
  const existing = readLock();
  if (lockIsActive(existing)) {
    const err = new Error('An update is already running on this server');
    err.code = 'UPDATE_IN_PROGRESS';
    throw err;
  }
  const lock = { pid: process.pid, owner: owner || 'api', at: new Date().toISOString() };
  writeJson(lockFilePath(), lock);
  return lock;
}

function releaseLock() {
  try {
    if (fs.existsSync(lockFilePath())) fs.unlinkSync(lockFilePath());
  } catch (_) { /* ignore */ }
}

function defaultManifestUrl() {
  if (process.env.NEXOR_UPDATE_MANIFEST_URL) return String(process.env.NEXOR_UPDATE_MANIFEST_URL);
  const repo = process.env.NEXOR_UPDATE_REPO || DEFAULT_REPO;
  const tag = process.env.NEXOR_UPDATE_TAG || DEFAULT_TAG;
  return `https://github.com/${repo}/releases/download/${tag}/latest-server.json`;
}

function requestText(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = 1024 * 1024 } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('Too many redirects'));
    let safeUrl;
    try {
      safeUrl = assertAllowedUpdateUrl(url);
    } catch (err) {
      return reject(err);
    }
    const req = https.get(safeUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,*/*' },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, safeUrl).href;
        requestText(next, { timeoutMs, maxBytes }, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Update check failed (HTTP ${res.statusCode})`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.destroy();
          reject(new Error('Update manifest is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Update check timed out'));
    });
  });
}

const DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'githubusercontent.com',
]);

function assertAllowedUpdateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid update URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Update download must use HTTPS');
  }
  const host = parsed.hostname.toLowerCase();
  const extra = String(process.env.NEXOR_UPDATE_ALLOW_HOST || '').trim().toLowerCase();
  const allowed = DOWNLOAD_HOSTS.has(host)
    || host.endsWith('.githubusercontent.com')
    || (extra && host === extra);
  if (!allowed) {
    throw new Error(`Refusing download from ${host}`);
  }
  const repoPath = `/${DEFAULT_REPO}/`;
  if (host === 'github.com' && !parsed.pathname.toLowerCase().includes(repoPath.toLowerCase())) {
    throw new Error('Refusing a GitHub URL that is not the NEXOR release');
  }
  return parsed.href;
}

function downloadToFile(url, destPath, { maxBytes = MAX_PACK_BYTES, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('Too many redirects'));
    let safeUrl;
    try {
      safeUrl = assertAllowedUpdateUrl(url);
    } catch (err) {
      return reject(err);
    }
    let parsed;
    try {
      parsed = new URL(safeUrl);
    } catch {
      return reject(new Error('Invalid download URL'));
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const lib = parsed.protocol === 'https:' ? https : http;
    const hash = crypto.createHash('sha512');
    let bytes = 0;
    const req = lib.get(safeUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream,*/*' },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, safeUrl).href;
        downloadToFile(next, destPath, { maxBytes, timeoutMs }, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed (HTTP ${res.statusCode})`));
        return;
      }
      const out = fs.createWriteStream(destPath);
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { out.destroy(); } catch (_) { /* ignore */ }
        try { fs.unlinkSync(destPath); } catch (_) { /* ignore */ }
        reject(err);
      };
      res.on('data', (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
        if (bytes > maxBytes) {
          req.destroy();
          fail(new Error('Update pack exceeds the 80 MB safety limit'));
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        if (settled) return;
        settled = true;
        resolve({ sha512: hash.digest('hex'), bytes });
      });
      out.on('error', fail);
      res.on('error', fail);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timed out'));
    });
  });
}

async function fetchLatestManifest() {
  const url = defaultManifestUrl();
  const text = await requestText(url);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Update manifest is not valid JSON');
  }
  const checked = validateManifest(parsed);
  if (!checked.ok) {
    throw new Error(checked.errors[0] || 'Invalid update manifest');
  }
  if (!checked.manifest.sha512) {
    throw new Error('Published pack is missing a SHA-512 checksum');
  }
  if (!checked.manifest.url) {
    const repo = process.env.NEXOR_UPDATE_REPO || DEFAULT_REPO;
    const tag = process.env.NEXOR_UPDATE_TAG || DEFAULT_TAG;
    checked.manifest.url = `https://github.com/${repo}/releases/download/${tag}/${checked.manifest.file}`;
  }
  checked.manifest.sourceUrl = url;
  return checked.manifest;
}

function serviceExists(name) {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync('sc.exe', ['query', name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    return true;
  } catch {
    return false;
  }
}

function findApplyScript() {
  const candidates = [
    path.join(updatesDir(), 'apply-nexor-server-update.ps1'),
    path.join(repoRootFromLib(), 'scripts', 'apply-nexor-server-update.ps1'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function listExtractedFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

function resolveExtractRoot(extractDir) {
  if (fs.existsSync(path.join(extractDir, 'manifest.json'))) return extractDir;
  const kids = fs.readdirSync(extractDir).filter((n) => !n.startsWith('.'));
  if (kids.length === 1) {
    const nested = path.join(extractDir, kids[0]);
    if (fs.existsSync(path.join(nested, 'manifest.json')) && fs.statSync(nested).isDirectory()) {
      return nested;
    }
  }
  return null;
}

async function extractAndValidatePack(zipPath, extractDir, expected) {
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  await execFileAsync('tar', ['-xf', zipPath, '-C', extractDir], {
    windowsHide: true,
    timeout: 60000,
  });

  const root = resolveExtractRoot(extractDir);
  if (!root) throw new Error('Update pack is missing manifest.json');

  const inner = validateManifest(readJsonIfExists(path.join(root, 'manifest.json')));
  if (!inner.ok || !inner.manifest) {
    throw new Error(inner.errors[0] || 'Pack manifest is invalid');
  }
  if (inner.manifest.buildId.toLowerCase() !== expected.buildId.toLowerCase()) {
    throw new Error('Pack buildId does not match the published manifest');
  }
  if (inner.manifest.appVersion !== ALLOWED_APP_VERSION) {
    throw new Error('Pack appVersion is not 1.3.8');
  }

  const kept = [];
  for (const full of listExtractedFiles(root)) {
    const rel = normalizeRel(path.relative(root, full));
    try {
      assertSafeRelPath(rel);
      kept.push(rel);
    } catch (err) {
      fs.unlinkSync(full);
      if (rel === 'manifest.json') throw err;
    }
  }

  if (!kept.includes('webapp/index.html') && !fs.existsSync(path.join(root, 'webapp', 'index.html'))) {
    throw new Error('Update pack is missing the web UI (webapp/index.html)');
  }
  if (!fs.existsSync(path.join(root, 'backend', 'src', 'server.js'))) {
    throw new Error('Update pack is missing backend/src/server.js');
  }

  return { root, manifest: inner.manifest };
}

function lockfileChanged(extractRoot, backendDir) {
  const incoming = path.join(extractRoot, 'backend', 'package-lock.json');
  const current = path.join(backendDir, 'package-lock.json');
  if (!fs.existsSync(incoming)) return false;
  if (!fs.existsSync(current)) return true;
  return sha512FileHex(incoming) !== sha512FileHex(current);
}

function applyPreconditions(db) {
  const reasons = [];
  if (process.platform !== 'win32') {
    reasons.push('In-app update only runs on the Windows city server');
  }
  if (!db || db.engine !== 'postgres') {
    reasons.push('This PC is not the PostgreSQL city server');
  }
  const serviceName = process.env.NEXOR_SERVICE_NAME || 'NexorBackend';
  if (process.platform === 'win32' && !serviceExists(serviceName)) {
    reasons.push(`Windows service ${serviceName} is not installed on this PC`);
  }
  const backendDir = backendRootFromLib();
  if (!fs.existsSync(path.join(backendDir, 'src', 'server.js'))) {
    reasons.push('Cannot find backend/src/server.js');
  }
  if (!findApplyScript()) {
    reasons.push('Update script is missing — install the NEXOR 1.3.8 build that includes Actualizar NEXOR');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    serviceName,
    backendDir,
    canApply: reasons.length === 0,
    reason: reasons[0] || null,
  };
}

async function buildUpdateStatus(db, { refreshLatest = true } = {}) {
  const { readAppVersion, GIT_COMMIT, readBuildStamp } = require('./deploymentStatus');
  const pre = applyPreconditions(db);
  const stamp = typeof readBuildStamp === 'function' ? readBuildStamp() : readBuildStampFiles();
  const currentBuildId = stamp?.commit || GIT_COMMIT || null;
  const job = readStatus();
  let latest = null;
  let latestError = null;
  if (refreshLatest && pre.ok) {
    try {
      latest = await fetchLatestManifest();
    } catch (err) {
      latestError = err.message || String(err);
    }
  }
  const updateAvailable = !!(latest && currentBuildId && !isSameBuild(currentBuildId, latest.buildId));
  const firstPackUnknown = !!(latest && !currentBuildId);
  return {
    ok: true,
    canApply: pre.canApply,
    reason: pre.reason,
    reasons: pre.reasons,
    appVersion: readAppVersion(),
    current: {
      appVersion: readAppVersion(),
      buildId: currentBuildId,
      buildIdShort: currentBuildId ? String(currentBuildId).slice(0, 7) : null,
      builtAt: stamp?.builtAt || null,
    },
    latest,
    latestError,
    updateAvailable: updateAvailable || firstPackUnknown,
    job,
    serviceName: pre.serviceName,
  };
}

function spawnApplyScript(opts) {
  const script = findApplyScript();
  if (!script) throw new Error('Apply script not found');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-ExtractDir', opts.extractDir,
    '-BackendDir', opts.backendDir,
    '-InstallDir', installDir(),
    '-StatusFile', statusFilePath(),
    '-NodeExe', process.execPath,
    '-ServiceName', opts.serviceName,
    '-BuildId', opts.buildId,
    '-HealthUrl', opts.healthUrl,
  ];
  if (opts.needNpmCi) args.push('-NeedNpmCi');
  const child = spawn('powershell.exe', args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function runApplyJob(pre) {
  const latest = await fetchLatestManifest();
  const { readBuildStamp, GIT_COMMIT } = require('./deploymentStatus');
  const stamp = typeof readBuildStamp === 'function' ? readBuildStamp() : readBuildStampFiles();
  const currentBuildId = stamp?.commit || GIT_COMMIT || null;
  if (currentBuildId && isSameBuild(currentBuildId, latest.buildId)) {
    releaseLock();
    writeStatus({
      phase: 'upToDate',
      message: 'This server is already on the latest NEXOR pack',
      ok: true,
      finishedAt: new Date().toISOString(),
      buildId: currentBuildId,
    });
    return;
  }

  const zipPath = path.join(updatesDir(), 'staging', 'nexor-server-update.zip');
  const extractDir = path.join(updatesDir(), 'staging', 'extract');
  writeStatus({
    phase: 'downloading',
    message: 'Downloading the NEXOR server pack…',
    buildId: latest.buildId,
    latest,
  });
  const downloaded = await downloadToFile(latest.url, zipPath);
  if (downloaded.sha512 !== latest.sha512) {
    throw new Error('Pack checksum does not match the published SHA-512 — update aborted');
  }

  writeStatus({ phase: 'verifying', message: 'Verifying the pack…' });
  const extracted = await extractAndValidatePack(zipPath, extractDir, latest);
  const needNpmCi = lockfileChanged(extracted.root, pre.backendDir);
  const port = Number(process.env.PORT) || 3000;
  const healthUrl = `http://127.0.0.1:${port}/api/health`;

  writeStatus({
    phase: 'applying',
    message: 'Applying files and restarting the NEXOR service…',
    needNpmCi,
  });

  const pid = spawnApplyScript({
    extractDir: extracted.root,
    backendDir: pre.backendDir,
    serviceName: pre.serviceName,
    buildId: latest.buildId,
    needNpmCi,
    healthUrl,
  });

  writeStatus({
    phase: 'restarting',
    message: 'Service is restarting. The screen will reconnect in about a minute.',
    applyPid: pid,
    buildId: latest.buildId,
  });
}

function startServerUpdate(db, { confirm, user } = {}) {
  if (!confirm) {
    const err = new Error('Confirm the update before applying it');
    err.code = 'CONFIRM_REQUIRED';
    throw err;
  }
  const pre = applyPreconditions(db);
  if (!pre.ok) {
    const err = new Error(pre.reason);
    err.code = 'NOT_ELIGIBLE';
    throw err;
  }

  acquireLock(user?.email || user?.id || 'admin');
  const job = writeStatus({
    phase: 'checking',
    message: 'Checking the published NEXOR pack…',
    ok: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    requestedBy: user?.email || user?.name || null,
    rollback: false,
  });

  setImmediate(() => {
    runApplyJob(pre).catch((err) => {
      console.error('[SERVER UPDATE]', err);
      releaseLock();
      writeStatus({
        phase: 'failed',
        message: err.message || String(err),
        ok: false,
        error: err.message || String(err),
        finishedAt: new Date().toISOString(),
      });
    });
  });

  return job;
}

module.exports = {
  PRODUCT,
  MANIFEST_SCHEMA,
  ALLOWED_APP_VERSION,
  MAX_PACK_BYTES,
  assertSafeRelPath,
  validateManifest,
  isSameBuild,
  sha512FileHex,
  sha512FileHexStreaming,
  readBuildStampFiles,
  readStatus,
  writeStatus,
  fetchLatestManifest,
  applyPreconditions,
  buildUpdateStatus,
  startServerUpdate,
  defaultManifestUrl,
  assertAllowedUpdateUrl,
};
