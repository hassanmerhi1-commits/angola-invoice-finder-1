const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateManifest } = require('../src/lib/serverUpdate');

test('latest-desktop.json shape is accepted as a 1.3.8 pack manifest', () => {
  const checked = validateManifest({
    schema: 1,
    product: 'nexor-erp',
    appVersion: '1.3.8',
    buildId: '1f389f6abcde0123456789abcdef0123456789ab',
    file: 'NEXOR-ERP-1.3.8-x64.exe',
    sha512: 'a'.repeat(128),
    size: 120000000,
    url: 'https://github.com/hassanmerhi1-commits/angola-invoice-finder-1/releases/download/v1.3.8/NEXOR-ERP-1.3.8-x64.exe',
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.manifest.file, 'NEXOR-ERP-1.3.8-x64.exe');
});

test('publicLatestPayload is not ready until a real exe is cached', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexor-desktop-'));
  process.env.NEXOR_INSTALL_DIR = root;
  const { publicLatestPayload, isCachedReady, readCachedMeta } = require('../src/lib/desktopShell');
  assert.equal(publicLatestPayload().ready, false);
  assert.equal(isCachedReady(readCachedMeta()), false);
});
