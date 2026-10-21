/**
 * In-app city-server update. Version stays 1.3.8 (AGT); we compare buildId.
 *
 * Safety: admin_settings + PostgreSQL + Windows service only. SHA-512 of the
 * zip, allowlisted paths, backup, migrate, health, rollback. The HTTP handler
 * never restarts itself. Apply is launched via a SYSTEM scheduled task so
 * Stop-Service on NexorBackend cannot kill the updater (Node detached:true
 * stays in the service job on Windows and died at "restarting").
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');
const { promisify } = require('util');
const {
  backendLooksComplete,
  findPackagedCompleteBackend,
  assertCopiedSrcComplete,
  missingCopiedSrcFiles,
} = require('./completeBackend');

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
const APPLY_TASK_NAME = 'NexorApplyUpdate';

const ALLOWED_REL_EXACT = new Set([
  'manifest.json',
  'backend/package.json',
  'backend/package-lock.json',
  'backend/BUILD_STAMP.json',
  'backend/scripts/ensure-server-schema.js',
  'scripts/apply-nexor-server-update.ps1',
  'scripts/finish-nexor-server-update.ps1',
  'scripts/apply-published-pack.ps1',
]);

const ALLOWED_REL_PREFIXES = ['webapp/', 'backend/src/', 'backend/scripts/lib/'];

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

function jobUpdatedAtMs(job) {
  if (!job) return 0;
  const raw = job.updatedAt || job.finishedAt || job.at;
  const ms = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function isBusyPhase(phase) {
  return ['checking', 'downloading', 'verifying', 'applying', 'restarting'].includes(String(phase || ''));
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Stable % for the Settings progress bar. Download uses bytes when known. */
function phasePercent(phase, extra) {
  const hint = extra && extra.percent != null ? Number(extra.percent) : null;
  if (hint != null && Number.isFinite(hint)) return clampPercent(hint);
  switch (String(phase || '')) {
    case 'checking':
      return 5;
    case 'downloading': {
      const bytes = Number(extra && extra.bytes) || 0;
      const total = Number(extra && extra.totalBytes) || 0;
      if (total > 0) return clampPercent(8 + (bytes / total) * 32);
      return 15;
    }
    case 'verifying':
      return 45;
    case 'applying':
      return 62;
    case 'restarting':
      return 88;
    case 'success':
    case 'upToDate':
      return 100;
    case 'failed':
      return 0;
    default:
      return 0;
  }
}

function isLaunchStuckJob(job) {
  if (!job) return false;
  const msg = String(job.message || '');
  const pct = Number(job.percent);
  return (job.phase === 'restarting' && /reconnect in about a minute/i.test(msg))
    || (job.phase === 'applying' && /Starting the updater/i.test(msg) && (!Number.isFinite(pct) || pct <= 58));
}

/** A hung apply (service did not come back) used to leave phase=restarting forever and lock the button. */
function expireStaleUpdateJob() {
  const job = readStatus();
  if (!job || !isBusyPhase(job.phase)) return job;
  const age = Date.now() - jobUpdatedAtMs(job);
  const staleMs = isLaunchStuckJob(job) ? 90 * 1000 : LOCK_STALE_MS;
  if (age < staleMs) return job;
  releaseLock();
  return writeStatus({
    phase: 'failed',
    message: isLaunchStuckJob(job)
      ? 'The updater did not start. Click Update NEXOR again.'
      : 'Previous update was interrupted while restarting. Check for update, then try Update NEXOR again.',
    ok: false,
    error: 'Update timed out',
    stale: true,
    finishedAt: new Date().toISOString(),
  });
}

function writeStatus(patch) {
  const prev = readStatus() || {};
  const merged = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  merged.percent = phasePercent(merged.phase, {
    percent: Object.prototype.hasOwnProperty.call(patch, 'percent') ? patch.percent : undefined,
    bytes: merged.bytes,
    totalBytes: merged.totalBytes,
  });
  writeJson(statusFilePath(), merged);
  return merged;
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
      let lastProgressAt = 0;
      const totalBytes = Number(res.headers['content-length']) || 0;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { out.destroy(); } catch (_) { /* ignore */ }
        try { fs.unlinkSync(destPath); } catch (_) { /* ignore */ }
        reject(err);
      };
      const reportDownload = (force) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < 400) return;
        lastProgressAt = now;
        const mb = (n) => (n / (1024 * 1024)).toFixed(1);
        writeStatus({
          phase: 'downloading',
          message: totalBytes
            ? `Downloading the NEXOR server pack… ${mb(bytes)} / ${mb(totalBytes)} MB`
            : 'Downloading the NEXOR server pack…',
          bytes,
          totalBytes: totalBytes || null,
        });
      };
      res.on('data', (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
        if (bytes > maxBytes) {
          req.destroy();
          fail(new Error('Update pack exceeds the 80 MB safety limit'));
          return;
        }
        reportDownload(false);
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

function copyDirOverwrite(fromDir, toDir, skipNames) {
  if (!fs.existsSync(fromDir)) throw new Error(`Missing pack folder: ${fromDir}`);
  const skip = skipNames instanceof Set ? skipNames : new Set(skipNames || []);
  fs.mkdirSync(toDir, { recursive: true });
  for (const name of fs.readdirSync(fromDir)) {
    if (skip.has(name)) continue;
    const src = path.join(fromDir, name);
    const dest = path.join(toDir, name);
    if (fs.statSync(src).isDirectory()) copyDirOverwrite(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function copyPackOntoLiveBackend(extractRoot, backendDir) {
  const srcFrom = path.join(extractRoot, 'backend', 'src');
  const webFrom = path.join(extractRoot, 'webapp');
  const srcServer = path.join(srcFrom, 'server.js');
  if (!fs.existsSync(srcServer)) {
    throw new Error('Pack is missing backend/src/server.js');
  }
  if (!fs.existsSync(path.join(webFrom, 'index.html'))) {
    throw new Error('Pack is missing webapp/index.html');
  }
  const extractFull = path.resolve(extractRoot).toLowerCase();
  const backendFull = path.resolve(backendDir).toLowerCase();
  if (extractFull === backendFull || extractFull.startsWith(`${backendFull}${path.sep.toLowerCase()}`)) {
    throw new Error('Extract folder must not sit inside the live backend folder');
  }
  const destSrc = path.join(backendDir, 'src');
  // Copy routes and other src files first. server.js last — a crash mid-copy
  // must not leave a new server.js requiring files that were never copied.
  copyDirOverwrite(srcFrom, destSrc, new Set(['server.js']));
  copyDirOverwrite(webFrom, path.join(backendDir, 'webapp'));
  for (const name of ['package.json', 'package-lock.json', 'BUILD_STAMP.json']) {
    const from = path.join(extractRoot, 'backend', name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(backendDir, name));
  }
  const scriptsLibFrom = path.join(extractRoot, 'backend', 'scripts', 'lib');
  if (fs.existsSync(scriptsLibFrom)) {
    copyDirOverwrite(scriptsLibFrom, path.join(backendDir, 'scripts', 'lib'));
  }
  const ensureFrom = path.join(extractRoot, 'backend', 'scripts', 'ensure-server-schema.js');
  if (fs.existsSync(ensureFrom)) {
    const dest = path.join(backendDir, 'scripts', 'ensure-server-schema.js');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(ensureFrom, dest);
  }
  const missingBeforeServer = missingCopiedSrcFiles(srcFrom, backendDir)
    .filter((rel) => rel !== 'src/server.js');
  if (missingBeforeServer.length) {
    throw new Error(`Update copy is incomplete (missing ${missingBeforeServer[0]})`);
  }
  fs.copyFileSync(srcServer, path.join(destSrc, 'server.js'));
  assertCopiedSrcComplete(srcFrom, backendDir);
  return backendDir;
}

function finalizeCopiedUpdateOnBoot() {
  const job = readStatus();
  if (!job) return job;
  const stamp = readBuildStampFiles();
  if (!stamp?.commit || !job.buildId || !isSameBuild(stamp.commit, job.buildId)) return job;
  if (job.phase === 'success' || job.phase === 'upToDate') return job;
  if (!isBusyPhase(job.phase) && job.phase !== 'failed') return job;
  releaseLock();
  return writeStatus({
    phase: 'success',
    message: 'NEXOR was updated.',
    ok: true,
    error: null,
    stale: false,
    percent: 100,
    finishedAt: new Date().toISOString(),
    buildId: stamp.commit,
  });
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
  const backendDir = resolveLiveBackendDir();
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
  let job = expireStaleUpdateJob();
  if (job && (job.phase === 'failed' || isBusyPhase(job.phase)) && currentBuildId && job.buildId
      && isSameBuild(currentBuildId, job.buildId)) {
    job = finalizeCopiedUpdateOnBoot() || writeStatus({
      phase: 'upToDate',
      message: 'This server is already on the latest NEXOR pack',
      ok: true,
      error: null,
      stale: false,
      percent: 100,
      finishedAt: new Date().toISOString(),
      buildId: currentBuildId,
    });
  }
  let latest = null;
  let latestError = null;
  if (refreshLatest && pre.ok) {
    try {
      latest = await fetchLatestManifest();
    } catch (err) {
      latestError = err.message || String(err);
    }
  }
  if (job && job.phase === 'failed' && latest && currentBuildId && isSameBuild(currentBuildId, latest.buildId)) {
    releaseLock();
    job = writeStatus({
      phase: 'upToDate',
      message: 'This server is already on the latest NEXOR pack',
      ok: true,
      error: null,
      stale: false,
      percent: 100,
      finishedAt: new Date().toISOString(),
      buildId: currentBuildId,
    });
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
      backendDir: pre.backendDir,
    },
    latest,
    latestError,
    updateAvailable: updateAvailable || firstPackUnknown,
    job,
    serviceName: pre.serviceName,
  };
}

function winQuote(value) {
  return `"${String(value).replace(/"/g, '')}"`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyLaunchCmdPath() {
  return path.join(updatesDir(), 'run-apply.cmd');
}

/** No spaces — schtasks /TR does not need quotes and cannot split on "NEXOR ERP". */
function stableApplyLaunchCmdPath() {
  return 'C:\\ProgramData\\NEXOR\\run-apply.cmd';
}

function legacyUnquotedApplyShimPath() {
  return 'C:\\NEXOR.cmd';
}

function buildSchtasksTr(cmdPath) {
  const stable = String(cmdPath || stableApplyLaunchCmdPath());
  return `cmd.exe /c ${winQuote(stable)}`;
}

function writeCompatibilityApplyShim(cmdPath) {
  const source = String(cmdPath || applyLaunchCmdPath());
  const stable = stableApplyLaunchCmdPath();
  try {
    fs.mkdirSync(path.dirname(stable), { recursive: true });
    if (source && fs.existsSync(source) && path.resolve(source) !== path.resolve(stable)) {
      fs.copyFileSync(source, stable);
    }
  } catch (err) {
    appendApplyLog(`ProgramData apply launcher copy failed: ${err.message || err}`);
  }
  const shim = [
    '@echo off',
    'REM NEXOR-APPLY-SHIM',
    `if exist ${winQuote(stable)} call ${winQuote(stable)} & goto :eof`,
    `if exist ${winQuote(applyLaunchCmdPath())} call ${winQuote(applyLaunchCmdPath())}`,
    '',
  ].join('\r\n');
  try {
    fs.writeFileSync(legacyUnquotedApplyShimPath(), shim, 'utf8');
  } catch (err) {
    appendApplyLog(`C:\\NEXOR.cmd shim failed: ${err.message || err}`);
  }
  return fs.existsSync(stable) ? stable : source;
}

function ensureApplyLaunchShim() {
  try {
    return writeCompatibilityApplyShim(applyLaunchCmdPath());
  } catch (_) {
    return null;
  }
}

function readNssmAppDirectory() {
  if (process.platform !== 'win32') return null;
  const serviceName = process.env.NEXOR_SERVICE_NAME || 'NexorBackend';
  const candidates = [
    path.join(installDir(), 'tools', 'nssm.exe'),
    'C:\\Program Files\\nssm\\nssm.exe',
  ];
  for (const nssm of candidates) {
    if (!nssm || !fs.existsSync(nssm)) continue;
    try {
      const out = execFileSync(nssm, ['get', serviceName, 'AppDirectory'], {
        windowsHide: true,
        timeout: 8000,
        encoding: 'utf8',
      });
      const dir = String(out || '').replace(/\0/g, '').trim();
      if (dir && fs.existsSync(path.join(dir, 'src', 'server.js'))) return dir;
    } catch (_) { /* next */ }
  }
  return null;
}

function resolveLiveBackendDir() {
  const nssmDir = readNssmAppDirectory();
  // Updates still target the folder NSSM actually starts, even if it is an
  // incomplete overlay — the copy is what repairs it. Start-up prefers a
  // complete tree (see server.js redirect + findPackagedCompleteBackend).
  if (nssmDir) return nssmDir;
  const running = backendRootFromLib();
  if (backendLooksComplete(running) || fs.existsSync(path.join(running, 'src', 'server.js'))) {
    return running;
  }
  const packaged = findPackagedCompleteBackend();
  if (packaged) return packaged;
  const installed = path.join(installDir(), 'backend');
  if (fs.existsSync(path.join(installed, 'src', 'server.js'))) return installed;
  return running;
}

function applyHasTakenOver(job) {
  if (!job) return false;
  if (job.applyAlive === true) return true;
  const msg = String(job.message || '');
  if (/Updater is running|Backing up|Stopping NexorBackend|Apply continues|Starting NexorBackend|Updating the database/i.test(msg)) {
    return true;
  }
  if (job.phase === 'success' || job.phase === 'failed') return true;
  return job.phase === 'applying' && Number(job.percent) >= 55 && !!job.backupDir;
}

async function waitForApplyTakeover(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    const job = readStatus();
    if (applyHasTakenOver(job)) return job;
  }
  return null;
}

function buildApplyLaunchCmdText(opts) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', winQuote(opts.script),
    '-ExtractDir', winQuote(opts.extractDir),
    '-BackendDir', winQuote(opts.backendDir),
    '-InstallDir', winQuote(opts.installDir),
    '-StatusFile', winQuote(opts.statusFile),
    '-NodeExe', winQuote(opts.nodeExe),
    '-ServiceName', winQuote(opts.serviceName),
    '-BuildId', winQuote(opts.buildId),
    '-HealthUrl', winQuote(opts.healthUrl),
  ];
  if (opts.needNpmCi) args.push('-NeedNpmCi');
  return [
    '@echo off',
    'set NEXOR_APPLY_INDEPENDENT=1',
    `cd /d ${winQuote(opts.updatesDir)}`,
    `powershell.exe ${args.join(' ')}`,
    '',
  ].join('\r\n');
}

function writeApplyLaunchCmd(opts) {
  const fromExtract = opts.extractDir
    ? path.join(opts.extractDir, 'scripts', 'apply-nexor-server-update.ps1')
    : '';
  const script = (fromExtract && fs.existsSync(fromExtract))
    ? fromExtract
    : findApplyScript();
  if (!script) throw new Error('Apply script not found');
  try {
    if (fromExtract && fs.existsSync(fromExtract)) {
      fs.copyFileSync(fromExtract, path.join(updatesDir(), 'apply-nexor-server-update.ps1'));
    }
  } catch (_) { /* ignore */ }
  fs.mkdirSync(updatesDir(), { recursive: true });
  const cmdPath = applyLaunchCmdPath();
  fs.writeFileSync(cmdPath, buildApplyLaunchCmdText({
    script,
    extractDir: opts.extractDir,
    backendDir: opts.backendDir,
    installDir: installDir(),
    statusFile: statusFilePath(),
    nodeExe: process.execPath,
    serviceName: opts.serviceName,
    buildId: opts.buildId,
    healthUrl: opts.healthUrl,
    needNpmCi: opts.needNpmCi,
    updatesDir: updatesDir(),
  }), 'utf8');
  return writeCompatibilityApplyShim(cmdPath);
}

function appendApplyLog(text) {
  try {
    fs.mkdirSync(updatesDir(), { recursive: true });
    fs.appendFileSync(
      path.join(updatesDir(), 'apply.log'),
      `${new Date().toISOString().replace('T', ' ').slice(0, 19)}  ${text}\n`,
      'utf8',
    );
  } catch (_) { /* ignore */ }
}

function schtasksOnceTime() {
  const d = new Date(Date.now() + 2 * 60 * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function launchApplyOutsideService(cmdPath) {
  const launchPath = writeCompatibilityApplyShim(cmdPath);
  const tr = buildSchtasksTr(launchPath);
  try {
    execFileSync('schtasks.exe', [
      '/Create', '/F',
      '/TN', APPLY_TASK_NAME,
      '/SC', 'ONCE',
      '/ST', schtasksOnceTime(),
      '/RU', 'SYSTEM',
      '/RL', 'HIGHEST',
      '/TR', tr,
    ], { windowsHide: true, timeout: 20000, encoding: 'utf8' });
    execFileSync('schtasks.exe', ['/Run', '/TN', APPLY_TASK_NAME], {
      windowsHide: true,
      timeout: 15000,
      encoding: 'utf8',
    });
    appendApplyLog(`Apply launched via scheduled task ${APPLY_TASK_NAME} TR=${tr}`);
    return { method: 'schtasks', pid: 0, tr };
  } catch (taskErr) {
    appendApplyLog(`schtasks launch failed: ${taskErr.message || taskErr}`);
  }
  try {
    const out = execFileSync('wmic.exe', ['process', 'call', 'create', launchPath], {
      windowsHide: true,
      timeout: 15000,
      encoding: 'utf8',
    });
    appendApplyLog('Apply launched via wmic process create');
    return { method: 'wmic', pid: 0, detail: String(out || '').slice(0, 200) };
  } catch (wmicErr) {
    appendApplyLog(`wmic launch failed: ${wmicErr.message || wmicErr}`);
  }
  const child = spawn('cmd.exe', ['/c', 'start', '/min', '', launchPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: updatesDir(),
  });
  child.unref();
  appendApplyLog(`Apply launched via cmd start pid=${child.pid}`);
  return { method: 'start', pid: child.pid };
}

function spawnApplyScript(opts) {
  const cmdPath = writeApplyLaunchCmd(opts);
  const launched = launchApplyOutsideService(cmdPath);
  return launched.pid || 0;
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
    bytes: 0,
    totalBytes: latest.size || null,
    percent: 8,
  });
  const downloaded = await downloadToFile(latest.url, zipPath);
  if (downloaded.sha512 !== latest.sha512) {
    throw new Error('Pack checksum does not match the published SHA-512 — update aborted');
  }

  writeStatus({ phase: 'verifying', message: 'Verifying the pack…', percent: 45 });
  const extracted = await extractAndValidatePack(zipPath, extractDir, latest);
  const needNpmCi = lockfileChanged(extracted.root, pre.backendDir);
  const port = Number(process.env.PORT) || 3000;
  const healthUrl = `http://127.0.0.1:${port}/api/health`;

  writeStatus({
    phase: 'applying',
    message: 'Copying files onto this server…',
    needNpmCi,
    percent: 55,
    buildId: latest.buildId,
  });
  copyPackOntoLiveBackend(extracted.root, pre.backendDir);
  writeStatus({
    phase: 'applying',
    message: 'Files copied. Restarting the NEXOR service…',
    needNpmCi,
    filesCopied: true,
    percent: 80,
    buildId: latest.buildId,
  });

  const pid = spawnApplyScript({
    extractDir: extracted.root,
    backendDir: pre.backendDir,
    serviceName: pre.serviceName,
    buildId: latest.buildId,
    needNpmCi,
    healthUrl,
  });

  const taken = await waitForApplyTakeover(20000);
  if (taken && taken.phase === 'failed') {
    throw new Error(taken.message || taken.error || 'The updater failed');
  }
  if (taken && taken.applyPid == null && pid) {
    writeStatus({ applyPid: pid, filesCopied: true });
  }
  if (!taken) {
    writeStatus({
      phase: 'restarting',
      message: 'Files copied. Restarting the NEXOR service…',
      filesCopied: true,
      applyPid: pid || 0,
      buildId: latest.buildId,
      percent: 88,
    });
    if (process.env.NEXOR_APPLY_NO_EXIT !== '1') {
      setTimeout(() => process.exit(0), 800);
    }
  }
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
    percent: 5,
    bytes: 0,
    totalBytes: null,
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
  phasePercent,
  APPLY_TASK_NAME,
  winQuote,
  buildApplyLaunchCmdText,
  buildSchtasksTr,
  stableApplyLaunchCmdPath,
  applyHasTakenOver,
  isLaunchStuckJob,
  resolveLiveBackendDir,
  ensureApplyLaunchShim,
  copyPackOntoLiveBackend,
  finalizeCopiedUpdateOnBoot,
  backendLooksComplete,
  findPackagedCompleteBackend,
};
