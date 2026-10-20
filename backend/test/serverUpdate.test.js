const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED_APP_VERSION,
  PRODUCT,
  assertSafeRelPath,
  assertAllowedUpdateUrl,
  validateManifest,
  isSameBuild,
  phasePercent,
  APPLY_TASK_NAME,
  winQuote,
  buildApplyLaunchCmdText,
  buildSchtasksTr,
  stableApplyLaunchCmdPath,
  applyHasTakenOver,
  isLaunchStuckJob,
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
  assert.equal(assertSafeRelPath('scripts/finish-nexor-server-update.ps1'), 'scripts/finish-nexor-server-update.ps1');
  assert.equal(assertSafeRelPath('scripts/apply-published-pack.ps1'), 'scripts/apply-published-pack.ps1');
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

test('apply launcher quotes spaced paths and can run outside the service', () => {
  assert.equal(APPLY_TASK_NAME, 'NexorApplyUpdate');
  assert.equal(winQuote('C:\\NEXOR ERP\\updates'), '"C:\\NEXOR ERP\\updates"');
  const text = buildApplyLaunchCmdText({
    script: 'C:\\NEXOR ERP\\updates\\apply-nexor-server-update.ps1',
    extractDir: 'C:\\NEXOR ERP\\updates\\staging\\extract',
    backendDir: 'C:\\NEXOR ERP\\backend',
    installDir: 'C:\\NEXOR ERP',
    statusFile: 'C:\\NEXOR ERP\\updates\\status.json',
    nodeExe: 'C:\\Program Files\\nodejs\\node.exe',
    serviceName: 'NexorBackend',
    buildId: 'abc1234',
    healthUrl: 'http://127.0.0.1:3000/api/health',
    needNpmCi: true,
    updatesDir: 'C:\\NEXOR ERP\\updates',
  });
  assert.match(text, /NEXOR_APPLY_INDEPENDENT=1/);
  assert.match(text, /cd \/d "C:\\NEXOR ERP\\updates"/);
  assert.match(text, /-File "C:\\NEXOR ERP\\updates\\apply-nexor-server-update.ps1"/);
  assert.match(text, /-NeedNpmCi/);
  assert.match(text, /powershell\.exe/);
  const tr = buildSchtasksTr(stableApplyLaunchCmdPath());
  assert.equal(tr, 'cmd.exe /c "C:\\ProgramData\\NEXOR\\run-apply.cmd"');
  assert.doesNotMatch(tr, /NEXOR ERP/);
  assert.equal(applyHasTakenOver({ applyAlive: true, phase: 'applying' }), true);
  assert.equal(applyHasTakenOver({ phase: 'applying', message: 'Starting the updater…', percent: 52 }), false);
  assert.equal(applyHasTakenOver({ phase: 'applying', message: 'Backing up the current server files...', percent: 55 }), true);
  assert.equal(isLaunchStuckJob({
    phase: 'restarting',
    message: 'Service is restarting. The screen will reconnect in about a minute.',
    percent: 88,
  }), true);
  assert.equal(isLaunchStuckJob({
    phase: 'applying',
    message: 'Starting the updater…',
    percent: 52,
  }), true);
  assert.equal(isLaunchStuckJob({
    phase: 'applying',
    message: 'Backing up the current server files...',
    percent: 55,
  }), false);
});

test('phasePercent maps update steps and download bytes', () => {
  assert.equal(phasePercent('checking'), 5);
  assert.equal(phasePercent('downloading'), 15);
  assert.equal(phasePercent('downloading', { bytes: 20, totalBytes: 100 }), 14);
  assert.equal(phasePercent('verifying'), 45);
  assert.equal(phasePercent('applying'), 62);
  assert.equal(phasePercent('restarting'), 88);
  assert.equal(phasePercent('restarting', { percent: 95 }), 95);
  assert.equal(phasePercent('success'), 100);
  assert.equal(phasePercent('failed'), 0);
});
