/**
 * electron-builder afterPack — guarantee updater runtime-deps exist in the packaged app.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const REQUIRED = [
  'electron-updater',
  'builder-util-runtime',
  'debug',
  'ms',
  'tiny-typed-emitter',
  'lodash.escaperegexp',
  'semver',
  'js-yaml',
  'lazy-val',
  'fs-extra',
  'lodash.isequal',
  'sax',
  'graceful-fs',
  'jsonfile',
  'universalify',
  'argparse',
];

function copyIfMissing(srcRoot, destRoot, pkg) {
  const dest = path.join(destRoot, pkg);
  if (fs.existsSync(path.join(dest, 'package.json'))) return false;
  const src = path.join(srcRoot, pkg);
  if (!fs.existsSync(path.join(src, 'package.json'))) {
    throw new Error(`Source package missing: ${pkg}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[after-pack-updater] copied missing package: ${pkg}`);
  return true;
}

module.exports = async function afterPackEnsureUpdaterDeps(context) {
  const appOutDir = context.appOutDir;
  const destRoot = path.join(appOutDir, 'resources', 'runtime-deps', 'node_modules');
  const srcRoot = path.join(__dirname, '..', 'node_modules');
  const stagedRoot = path.join(__dirname, '..', 'build', 'updater-runtime-deps', 'node_modules');

  fs.mkdirSync(destRoot, { recursive: true });

  for (const pkg of REQUIRED) {
    if (fs.existsSync(path.join(destRoot, pkg, 'package.json'))) continue;
    if (fs.existsSync(path.join(stagedRoot, pkg, 'package.json'))) {
      fs.cpSync(path.join(stagedRoot, pkg), path.join(destRoot, pkg), { recursive: true });
      console.log(`[after-pack-updater] restored from staged: ${pkg}`);
      continue;
    }
    copyIfMissing(srcRoot, destRoot, pkg);
  }

  const tempRoot = path.join(appOutDir, '_updater_verify_tmp');
  const runtimeDeps = path.join(appOutDir, 'resources', 'runtime-deps');
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.cpSync(runtimeDeps, path.join(tempRoot, 'runtime-deps'), { recursive: true });
  try {
    const entry = path.join(tempRoot, 'runtime-deps', 'node_modules', 'electron-updater', 'package.json');
    createRequire(entry)('electron-updater');
    console.log('[after-pack-updater] verify OK — electron-updater loads from packaged runtime-deps');
  } catch (err) {
    throw new Error(`Packaged electron-updater failed isolation load: ${err?.message || err}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
