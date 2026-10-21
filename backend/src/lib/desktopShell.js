/**
 * City cache of the desktop installer so tills take the one-time shell
 * over the LAN — no GitHub from each PC, no USB visit.
 * Version stays 1.3.8; we compare buildId.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const {
  validateManifest,
  isSameBuild,
  sha512FileHexStreaming,
  assertAllowedUpdateUrl,
} = require('./serverUpdate');

const DEFAULT_TAG = 'v1.3.8';
const DEFAULT_REPO = 'hassanmerhi1-commits/angola-invoice-finder-1';
const USER_AGENT = 'NEXOR-ERP-DesktopShell/1.3.8';
const MAX_EXE_BYTES = 400 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 8 * 60 * 1000;

let ensureInFlight = null;

function installDir() {
  return process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
}

function desktopDir() {
  return path.join(installDir(), 'updates', 'desktop');
}

function metaPath() {
  return path.join(desktopDir(), 'latest-desktop.json');
}

function exePathFor(fileName) {
  return path.join(desktopDir(), path.basename(String(fileName || 'NEXOR-ERP-1.3.8-x64.exe')));
}

function defaultDesktopManifestUrl() {
  if (process.env.NEXOR_DESKTOP_MANIFEST_URL) return String(process.env.NEXOR_DESKTOP_MANIFEST_URL);
  const repo = process.env.NEXOR_UPDATE_REPO || DEFAULT_REPO;
  const tag = process.env.NEXOR_UPDATE_TAG || DEFAULT_TAG;
  return `https://github.com/${repo}/releases/download/${tag}/latest-desktop.json`;
}

function requestText(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('Too many redirects'));
    let safeUrl;
    try {
      safeUrl = assertAllowedUpdateUrl(url);
    } catch (err) {
      return reject(err);
    }
    const parsed = new URL(safeUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(parsed, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,*/*' },
      timeout: FETCH_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, safeUrl).href;
        requestText(next, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Desktop manifest failed (HTTP ${res.statusCode})`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          req.destroy();
          reject(new Error('Desktop manifest is too large'));
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
      reject(new Error('Desktop manifest timed out'));
    });
  });
}

function downloadToFile(url, destPath, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('Too many redirects'));
    let safeUrl;
    try {
      safeUrl = assertAllowedUpdateUrl(url);
    } catch (err) {
      return reject(err);
    }
    const parsed = new URL(safeUrl);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const lib = parsed.protocol === 'https:' ? https : http;
    const hash = crypto.createHash('sha512');
    let bytes = 0;
    const tmp = `${destPath}.part`;
    const out = fs.createWriteStream(tmp);
    const req = lib.get(parsed, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream,*/*' },
      timeout: DOWNLOAD_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        out.close();
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        const next = new URL(res.headers.location, safeUrl).href;
        downloadToFile(next, destPath, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        out.close();
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        reject(new Error(`Desktop installer failed (HTTP ${res.statusCode})`));
        return;
      }
      res.on('data', (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
        if (bytes > MAX_EXE_BYTES) {
          req.destroy();
          out.close();
          try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
          reject(new Error('Desktop installer is larger than allowed'));
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close();
        try {
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          fs.renameSync(tmp, destPath);
        } catch (err) {
          reject(err);
          return;
        }
        resolve({ bytes, sha512: hash.digest('hex') });
      });
      out.on('error', reject);
    });
    req.on('error', (err) => {
      out.close();
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      out.close();
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      reject(new Error('Desktop installer download timed out'));
    });
  });
}

function readCachedMeta() {
  try {
    return JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
  } catch {
    return null;
  }
}

function isCachedReady(meta) {
  if (!meta?.buildId || !meta?.file || !meta?.sha512) return false;
  const exe = exePathFor(meta.file);
  return fs.existsSync(exe) && fs.statSync(exe).size > 1000000;
}

async function fetchLatestDesktopManifest() {
  const url = defaultDesktopManifestUrl();
  const text = await requestText(url);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Desktop manifest is not valid JSON');
  }
  const checked = validateManifest(parsed);
  if (!checked.ok) throw new Error(checked.errors[0] || 'Invalid desktop manifest');
  if (!checked.manifest.sha512) throw new Error('Desktop manifest is missing SHA-512');
  if (!checked.manifest.url) {
    const repo = process.env.NEXOR_UPDATE_REPO || DEFAULT_REPO;
    const tag = process.env.NEXOR_UPDATE_TAG || DEFAULT_TAG;
    checked.manifest.url = `https://github.com/${repo}/releases/download/${tag}/${checked.manifest.file}`;
  }
  return checked.manifest;
}

async function ensureDesktopShellCached() {
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = (async () => {
    const latest = await fetchLatestDesktopManifest();
    const cached = readCachedMeta();
    const exe = exePathFor(latest.file);
    if (cached && isSameBuild(cached.buildId, latest.buildId) && isCachedReady(cached)) {
      return { ok: true, skipped: true, manifest: cached };
    }
    fs.mkdirSync(desktopDir(), { recursive: true });
    const downloaded = await downloadToFile(latest.url, exe);
    const onDisk = await sha512FileHexStreaming(exe);
    if (onDisk.toLowerCase() !== String(latest.sha512).toLowerCase()) {
      throw new Error('Desktop installer checksum did not match');
    }
    if (downloaded.sha512.toLowerCase() !== onDisk.toLowerCase()) {
      throw new Error('Desktop installer hash mismatch while saving');
    }
    const meta = {
      ...latest,
      size: fs.statSync(exe).size,
      cachedAt: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath(), `${JSON.stringify(meta, null, 2)}\n`);
    return { ok: true, skipped: false, manifest: meta };
  })().finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

function publicLatestPayload() {
  const cached = readCachedMeta();
  if (!isCachedReady(cached)) {
    return {
      ok: true,
      ready: false,
      appVersion: '1.3.8',
    };
  }
  return {
    ok: true,
    ready: true,
    appVersion: cached.appVersion || '1.3.8',
    buildId: cached.buildId,
    buildIdShort: String(cached.buildId).slice(0, 7),
    file: cached.file,
    size: cached.size || null,
    sha512: cached.sha512,
  };
}

function openCachedInstaller() {
  const cached = readCachedMeta();
  if (!isCachedReady(cached)) return null;
  return {
    meta: cached,
    filePath: exePathFor(cached.file),
  };
}

module.exports = {
  defaultDesktopManifestUrl,
  ensureDesktopShellCached,
  publicLatestPayload,
  openCachedInstaller,
  isCachedReady,
  readCachedMeta,
};
