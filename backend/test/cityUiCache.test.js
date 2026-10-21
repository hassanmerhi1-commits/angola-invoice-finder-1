const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {
  parseWebappAssetRels,
  lookLikeLiveWebapp,
  hasCityUiCache,
  snapshotCityWebapp,
  startCityUiCacheServer,
} = require('../../electron/cityUiCache.cjs');
const { listWebappFiles, buildWebappManifest } = require('../src/lib/webappManifest');

test('parseWebappAssetRels keeps hashed /app assets', () => {
  const html = '<script src="/app/assets/index-abc123.js"></script><link href="/app/assets/index-abc123.css">';
  assert.deepEqual(parseWebappAssetRels(html).sort(), [
    'assets/index-abc123.css',
    'assets/index-abc123.js',
  ]);
});

test('lookLikeLiveWebapp rejects the missing-bundle page', () => {
  assert.equal(lookLikeLiveWebapp('<h1>NEXOR web UI is not installed</h1>'), false);
  assert.equal(lookLikeLiveWebapp('<script src="/app/assets/index-9f3a.js"></script>'), true);
});

test('hasCityUiCache requires the entry JS on disk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexor-ui-cache-'));
  const current = path.join(root, 'current');
  fs.mkdirSync(path.join(current, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(current, 'index.html'), '<script src="/app/assets/index-aa.js"></script>');
  assert.equal(hasCityUiCache(root), false);
  fs.writeFileSync(path.join(current, 'assets', 'index-aa.js'), 'console.log(1)');
  assert.equal(hasCityUiCache(root), true);
});

test('snapshotCityWebapp writes current from manifest + html', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexor-ui-snap-'));
  const files = {
    '/api/webapp-version': { stamp: 'deadbeefdeadbeef' },
    '/api/webapp-manifest': { stamp: 'deadbeefdeadbeef', files: ['index.html', 'assets/index-aa.js', 'icon.png'] },
    '/app/': '<script src="/app/assets/index-aa.js"></script>',
    '/app/index.html': '<script src="/app/assets/index-aa.js"></script>',
    '/app/assets/index-aa.js': 'import("/app/assets/chunk-bb.js")',
    '/app/icon.png': Buffer.from([1, 2, 3, 4]),
    '/app/assets/chunk-bb.js': 'export default 1',
  };
  const result = await snapshotCityWebapp('http://192.168.1.10:3000', {
    cacheRoot: root,
    fetchJson: async (url) => files[new URL(url).pathname],
    fetchBuffer: async (url) => {
      const body = files[new URL(url).pathname];
      if (body == null) return null;
      return Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    },
  });
  assert.equal(result.ok, true);
  assert.equal(hasCityUiCache(root), true);
  assert.equal(
    fs.readFileSync(path.join(root, 'current', 'assets', 'chunk-bb.js'), 'utf8'),
    'export default 1',
  );
});

test('cache server only answers /app from the snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexor-ui-http-'));
  const current = path.join(root, 'current');
  fs.mkdirSync(path.join(current, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(current, 'index.html'), '<script src="/app/assets/index-aa.js"></script>');
  fs.writeFileSync(path.join(current, 'assets', 'index-aa.js'), 'window.__NEXOR=1');
  const { server, port } = await startCityUiCacheServer(root);
  try {
    const html = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/app/`, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
    assert.match(html, /index-aa\.js/);
  } finally {
    server.close();
  }
});

test('listWebappFiles walks a folder and skips node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexor-webapp-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<script src="/app/assets/index-aa.js"></script>');
  fs.writeFileSync(path.join(root, 'assets', 'index-aa.js'), '1');
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'evil.js'), 'nope');
  const manifest = buildWebappManifest(root);
  assert.equal(manifest.ok, true);
  assert.ok(manifest.stamp);
  assert.deepEqual(manifest.files.sort(), ['assets/index-aa.js', 'index.html']);
  assert.equal(listWebappFiles(root).includes('node_modules/x/evil.js'), false);
});
