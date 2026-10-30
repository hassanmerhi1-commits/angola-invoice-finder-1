/**
 * Last-seen city /app on this PC.
 * Live tills load http://CITY/app. When that host is down, Electron used to
 * open the installer copy (months behind). Keep a snapshot instead.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const MAX_FILES = 400;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

function assertSafeRel(rel) {
  const n = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!n || n.includes('..') || n.includes('\0') || /^[a-zA-Z]:/.test(n)) {
    throw new Error(`unsafe webapp path: ${rel}`);
  }
  return n;
}

function parseWebappAssetRels(html) {
  const rels = new Set();
  const text = String(html || '');
  for (const match of text.matchAll(/\/app\/([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)/g)) {
    try {
      rels.add(assertSafeRel(match[1]));
    } catch {
      /* skip */
    }
  }
  return [...rels];
}

function lookLikeLiveWebapp(html) {
  return /index-[^"' ]+\.js/.test(String(html || ''));
}

function currentDir(cacheRoot) {
  return path.join(cacheRoot, 'current');
}

function readStamp(cacheRoot) {
  try {
    const raw = fs.readFileSync(path.join(currentDir(cacheRoot), 'stamp.json'), 'utf8');
    const json = JSON.parse(raw);
    return json?.stamp ? String(json.stamp) : null;
  } catch {
    return null;
  }
}

function hasCityUiCache(cacheRoot) {
  const indexPath = path.join(currentDir(cacheRoot), 'index.html');
  try {
    const html = fs.readFileSync(indexPath, 'utf8');
    if (!lookLikeLiveWebapp(html)) return false;
    const rels = parseWebappAssetRels(html).filter((rel) => rel.startsWith('assets/'));
    if (!rels.length) return false;
    return rels.every((rel) => fs.existsSync(path.join(currentDir(cacheRoot), rel)));
  } catch {
    return false;
  }
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.ttf') return 'font/ttf';
  return 'application/octet-stream';
}

function resolveUnder(rootDir, rel) {
  const safe = assertSafeRel(rel);
  const abs = path.resolve(rootDir, safe);
  const root = path.resolve(rootDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`path escape: ${rel}`);
  }
  return abs;
}

function writeFileAtomicish(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}

function swapStagingToCurrent(cacheRoot) {
  const staging = path.join(cacheRoot, 'staging');
  const current = currentDir(cacheRoot);
  const previous = path.join(cacheRoot, 'previous');
  if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
  if (fs.existsSync(current)) fs.renameSync(current, previous);
  fs.renameSync(staging, current);
  if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
}

async function snapshotCityWebapp(cityBase, opts) {
  const cacheRoot = opts.cacheRoot;
  const fetchJson = opts.fetchJson;
  const fetchBuffer = opts.fetchBuffer;
  const base = String(cityBase || '').replace(/\/$/, '');
  if (!base) return { ok: false, error: 'no-url' };

  let stamp = null;
  try {
    const version = await fetchJson(`${base}/api/webapp-version`);
    stamp = version?.stamp ? String(version.stamp) : null;
  } catch {
    stamp = null;
  }
  if (stamp && stamp === readStamp(cacheRoot) && hasCityUiCache(cacheRoot)) {
    return { ok: true, skipped: true, stamp };
  }

  const htmlBuf = await fetchBuffer(`${base}/app/`);
  const html = Buffer.isBuffer(htmlBuf) ? htmlBuf.toString('utf8') : String(htmlBuf || '');
  if (!lookLikeLiveWebapp(html)) {
    return { ok: false, error: 'not-a-webapp' };
  }

  const rels = new Set(['index.html', ...parseWebappAssetRels(html)]);
  try {
    const manifest = await fetchJson(`${base}/api/webapp-manifest`);
    for (const file of manifest?.files || []) {
      try {
        rels.add(assertSafeRel(file));
      } catch {
        /* skip */
      }
    }
    if (!stamp && manifest?.stamp) stamp = String(manifest.stamp);
  } catch {
    /* older city server — HTML scrape is enough */
  }

  const staging = path.join(cacheRoot, 'staging');
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  writeFileAtomicish(path.join(staging, 'index.html'), html);

  const pending = [...rels];
  const seen = new Set();
  while (pending.length) {
    if (seen.size >= MAX_FILES) break;
    const rel = pending.shift();
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    if (rel === 'index.html') continue;
    const buf = await fetchBuffer(`${base}/app/${rel}`);
    if (!buf || !Buffer.isBuffer(buf) || !buf.length) continue;
    if (buf.length > MAX_FILE_BYTES) continue;
    writeFileAtomicish(resolveUnder(staging, rel), buf);
    if (rel.endsWith('.js')) {
      for (const extra of parseWebappAssetRels(buf.toString('utf8'))) {
        if (!seen.has(extra)) pending.push(extra);
      }
    }
  }

  writeFileAtomicish(
    path.join(staging, 'stamp.json'),
    `${JSON.stringify({ stamp, savedAt: new Date().toISOString(), cityBase: base }, null, 2)}\n`,
  );

  if (!lookLikeLiveWebapp(fs.readFileSync(path.join(staging, 'index.html'), 'utf8'))) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: 'staging-invalid' };
  }

  swapStagingToCurrent(cacheRoot);
  return { ok: true, stamp, files: seen.size };
}

function startCityUiCacheServer(cacheRoot, listen) {
  const bind = listen || ((server, cb) => server.listen(0, '127.0.0.1', cb));
  const server = http.createServer((req, res) => {
    const host = String(req.socket?.remoteAddress || '');
    if (host !== '127.0.0.1' && host !== '::1' && host !== '::ffff:127.0.0.1') {
      res.writeHead(403);
      res.end();
      return;
    }
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    } catch {
      pathname = '/';
    }
    const root = currentDir(cacheRoot);
    let rel = 'index.html';
    if (pathname.startsWith('/app/')) {
      const rest = pathname.slice('/app/'.length);
      rel = rest && !rest.endsWith('/') ? rest : 'index.html';
    } else if (pathname !== '/app') {
      res.writeHead(404);
      res.end();
      return;
    }
    let filePath;
    try {
      filePath = resolveUnder(root, rel);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(root, 'index.html');
    }
    try {
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mimeFor(filePath), 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    bind(server, () => {
      const addr = server.address();
      resolve({ server, port: addr && addr.port });
    });
  });
}

/**
 * Installer UI (Vite base "./"). file:// blocks those module scripts
 * (crossorigin + origin null), which leaves a blank window. Serve the
 * dist folder on loopback so the same HTML can start.
 */
function startPackagedUiServer(distDir, listen) {
  const bind = listen || ((server, cb) => server.listen(0, '127.0.0.1', cb));
  const root = path.resolve(distDir);
  const server = http.createServer((req, res) => {
    const host = String(req.socket?.remoteAddress || '');
    if (host !== '127.0.0.1' && host !== '::1' && host !== '::ffff:127.0.0.1') {
      res.writeHead(403);
      res.end();
      return;
    }
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let filePath;
    try {
      filePath = resolveUnder(root, rel);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    try {
      const body = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': mimeFor(filePath),
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    bind(server, () => {
      const addr = server.address();
      resolve({ server, port: addr && addr.port });
    });
  });
}

module.exports = {
  assertSafeRel,
  parseWebappAssetRels,
  lookLikeLiveWebapp,
  hasCityUiCache,
  readStamp,
  snapshotCityWebapp,
  startCityUiCacheServer,
  startPackagedUiServer,
  currentDir,
};
