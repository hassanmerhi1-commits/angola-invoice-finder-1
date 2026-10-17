const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED_APP_VERSION,
  PRODUCT,
  assertSafeRelPath,
  assertAllowedUpdateUrl,
  validateManifest,
  isSameBuild,
} = require('../src/lib/serverUpdate');

test('AGT version stays locked at 1.3.8', () => {
  assert.equal(ALLOWED_APP_VERSION, '1.3.8');
  assert.equal(PRODUCT, 'nexor-erp');
});

test('validateManifest accepts a published latest-server.json', () => {
  const checked = validateManifest({
    schema: 1,
    product: 'nexor-erp',
    appVersion: '1.3.8',
    buildId: '1f389f6abcde0123456789abcdef0123456789ab',
    builtAt: '2026-10-17T08:00:00.000Z',
    file: 'nexor-server-update.zip',
    sha512: 'a'.repeat(128),
    size: 12,
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.manifest.buildIdShort, '1f389f6');
});

test('validateManifest rejects a version bump', () => {
  const checked = validateManifest({
    schema: 1,
    product: 'nexor-erp',
    appVersion: '1.3.9',
    buildId: 'abc1234',
  });
  assert.equal(checked.ok, false);
  assert.match(checked.errors[0], /1\.3\.8/);
});

test('validateManifest rejects the wrong product or schema', () => {
  assert.equal(validateManifest({ schema: 2, product: 'nexor-erp', appVersion: '1.3.8', buildId: 'abc1234' }).ok, false);
  assert.equal(validateManifest({ schema: 1, product: 'other', appVersion: '1.3.8', buildId: 'abc1234' }).ok, false);
  assert.equal(validateManifest(null).ok, false);
});

test('validateManifest rejects a missing or short buildId', () => {
  assert.equal(validateManifest({ schema: 1, product: 'nexor-erp', appVersion: '1.3.8', buildId: 'abc' }).ok, false);
  assert.equal(validateManifest({ schema: 1, product: 'nexor-erp', appVersion: '1.3.8' }).ok, false);
});

test('validateManifest rejects a bad sha512 or file name', () => {
  const base = { schema: 1, product: 'nexor-erp', appVersion: '1.3.8', buildId: 'abc1234' };
  assert.equal(validateManifest({ ...base, sha512: 'deadbeef' }).ok, false);
  assert.equal(validateManifest({ ...base, file: '../evil.zip' }).ok, false);
});

test('assertSafeRelPath allows only the update allowlist', () => {
  assert.equal(assertSafeRelPath('webapp/index.html'), 'webapp/index.html');
  assert.equal(assertSafeRelPath('backend/src/server.js'), 'backend/src/server.js');
  assert.equal(assertSafeRelPath('backend/package.json'), 'backend/package.json');
  assert.equal(assertSafeRelPath('manifest.json'), 'manifest.json');
  assert.throws(() => assertSafeRelPath('../etc/passwd'));
  assert.throws(() => assertSafeRelPath('C:/Windows/system.ini'));
  assert.throws(() => assertSafeRelPath('backend/.env'));
  assert.throws(() => assertSafeRelPath('webapp/payload.exe'));
  assert.throws(() => assertSafeRelPath('database.env'));
  assert.throws(() => assertSafeRelPath('backend/src/secret.pem'));
  assert.throws(() => assertSafeRelPath('node_modules/leftpad/index.js'));
});

test('assertAllowedUpdateUrl only accepts the NEXOR GitHub release', () => {
  assert.equal(
    assertAllowedUpdateUrl('https://github.com/hassanmerhi1-commits/angola-invoice-finder-1/releases/download/v1.3.8/latest-server.json').includes('github.com'),
    true,
  );
  assert.throws(() => assertAllowedUpdateUrl('http://github.com/hassanmerhi1-commits/angola-invoice-finder-1/releases/download/v1.3.8/x.zip'));
  assert.throws(() => assertAllowedUpdateUrl('https://evil.example/pack.zip'));
  assert.throws(() => assertAllowedUpdateUrl('https://github.com/someone-else/other-repo/releases/download/v1/x.zip'));
  assert.throws(() => assertAllowedUpdateUrl('https://127.0.0.1/pack.zip'));
});

test('isSameBuild matches full and short SHAs', () => {
  assert.equal(isSameBuild('1f389f6abcde', '1f389f6'), true);
  assert.equal(isSameBuild('1f389f6', '1f389f6abcde'), true);
  assert.equal(isSameBuild('aaaaaaaa', 'bbbbbbbb'), false);
  assert.equal(isSameBuild('', 'abc1234'), false);
});
