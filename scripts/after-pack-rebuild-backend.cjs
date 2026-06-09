/**
 * electron-builder afterPack hook — rebuild better-sqlite3 inside the packaged
 * app using the **exact** Electron binary that ships in win-unpacked.
 *
 * Dev `npm run rebuild:backend` targets node_modules/electron; the packaged .exe
 * can still differ if the installer was built without a fresh rebuild. A mismatch
 * (NODE_MODULE_VERSION) makes embedded Express crash on start → "database not connected".
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const appOutDir = context.appOutDir;
  const productName = context.packager?.appInfo?.productFilename || 'NEXOR ERP';
  const electronExe = path.join(appOutDir, `${productName}.exe`);
  const backendRoot = path.join(appOutDir, 'resources', 'backend');

  if (!fs.existsSync(electronExe)) {
    console.warn('[after-pack-rebuild-backend] Skip — electron exe not found:', electronExe);
    return;
  }
  if (!fs.existsSync(path.join(backendRoot, 'package.json'))) {
    console.warn('[after-pack-rebuild-backend] Skip — backend tree not found:', backendRoot);
    return;
  }

  // Use the Electron version electron-builder packaged — NOT `electron -v` (that prints Node).
  let electronVersion =
    context.packager?.config?.electronVersion
    || context.electronVersion
    || '';
  if (!electronVersion) {
    try {
      electronVersion = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version;
    } catch (_) {
      electronVersion = '';
    }
  }
  if (!electronVersion) {
    throw new Error('[after-pack-rebuild-backend] Could not determine packaged Electron version.');
  }

  console.log(`[after-pack-rebuild-backend] Rebuilding better-sqlite3 for packaged Electron ${electronVersion}…`);

  const cmd = `npx --yes @electron/rebuild -f -w better-sqlite3 -v ${electronVersion} --module-dir "${backendRoot}"`;
  try {
    execFileSync(cmd, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
  } catch (e) {
    console.error('[after-pack-rebuild-backend] FAILED — packaged app will not connect to SQLite.');
    throw e;
  }

  console.log('[after-pack-rebuild-backend] OK');

  const ensureUpdaterDeps = require('./after-pack-ensure-updater-deps.cjs');
  await ensureUpdaterDeps(context);
};
