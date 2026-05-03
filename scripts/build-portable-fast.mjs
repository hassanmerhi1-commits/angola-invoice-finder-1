import { mkdirSync, cpSync, existsSync, rmSync, writeFileSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const stageRoot = path.join(root, '.tmp-electron-package');
const appDir = path.join(stageRoot, 'app');
const runtimeNodeModulesDir = path.join(appDir, 'node_modules');
const backendDir = path.join(appDir, 'backend');
const releaseDir = path.join(root, 'release');
const uniqueOutDir = path.join(stageRoot, 'release-out');
const builderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');

const copyIfExists = (from, to) => {
  if (!existsSync(from)) return;
  cpSync(from, to, {
    recursive: true,
    force: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (src) => {
      try { if (lstatSync(src).isSymbolicLink()) return false; } catch {}
      const norm = src.replace(/\\/g, '/');
      if (norm.includes('/.tmp-electron-package')) return false;
      if (norm.includes('/release/')) return false;
      return true;
    }
  });
};

const ensureCleanDir = (dir) => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
};

const rootPkg = JSON.parse(execFileSync('node', ['-p', "JSON.stringify(require('./package.json'))"], {
  cwd: root,
  encoding: 'utf8',
}));
const electronVersion = String(rootPkg.devDependencies?.electron || '').replace(/^[^\d]*/, '');

const stagePkg = {
  name: rootPkg.name,
  productName: rootPkg.productName,
  version: rootPkg.version,
  description: rootPkg.description,
  author: 'NEXOR ERP',
  private: true,
  main: 'electron/main.cjs',
  type: 'commonjs',
  dependencies: {}
};

const windowsIconPath = path.join(root, 'build', 'icon.ico');

const builderConfig = {
  appId: 'com.nexor.erp',
  productName: 'NEXOR ERP',
  electronVersion,
  compression: 'store',
  npmRebuild: false,
  directories: {
    app: appDir,
    output: uniqueOutDir,
    buildResources: path.join(root, 'build')
  },
  extraMetadata: { dependencies: {} },
  files: ['dist/**/*', 'electron/**/*', 'backend/**/*', 'node_modules/**/*', 'package.json'],
  win: {
    target: [{ target: 'portable', arch: ['x64'] }],
    artifactName: 'NEXOR-ERP-Portable-${version}.${ext}',
    signAndEditExecutable: false,
    signtoolOptions: { sign: null }
  }
};

if (existsSync(windowsIconPath)) {
  builderConfig.win.icon = windowsIconPath;
}

ensureCleanDir(stageRoot);
mkdirSync(releaseDir, { recursive: true });
mkdirSync(appDir, { recursive: true });
mkdirSync(runtimeNodeModulesDir, { recursive: true });
mkdirSync(path.join(appDir, 'public'), { recursive: true });

copyIfExists(path.join(root, 'dist'), path.join(appDir, 'dist'));
copyIfExists(path.join(root, 'electron'), path.join(appDir, 'electron'));
copyIfExists(path.join(root, 'backend'), backendDir);
copyIfExists(path.join(root, 'public', 'splash.png'), path.join(appDir, 'public', 'splash.png'));

const runtimeModules = [
  'ws','pg','pg-pool','pg-protocol','pg-types','pg-connection-string','pgpass',
  'buffer-writer','packet-reader','electron-updater','builder-util-runtime',
  'lazy-val','semver','js-yaml','argparse','sax','lodash.isequal',
  'fs-extra','graceful-fs','jsonfile','universalify'
];

for (const mod of runtimeModules) {
  copyIfExists(path.join(root, 'node_modules', mod), path.join(runtimeNodeModulesDir, mod));
}

copyIfExists(path.join(root, 'backend', 'node_modules'), path.join(backendDir, 'node_modules'));
writeFileSync(path.join(stageRoot, 'package.json'), JSON.stringify(stagePkg, null, 2));
writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(stagePkg, null, 2));
writeFileSync(path.join(stageRoot, 'electron-builder.fast.json'), JSON.stringify(builderConfig, null, 2));

execFileSync('node', [
  builderCli,
  '--projectDir', stageRoot,
  '--config', path.join(stageRoot, 'electron-builder.fast.json'),
  '--win', 'portable',
  '--publish', 'never'
], {
  cwd: stageRoot,
  stdio: 'inherit'
});

for (const name of readdirSync(uniqueOutDir)) {
  if (name.toLowerCase().endsWith('.exe')) {
    const src = path.join(uniqueOutDir, name);
    const dest = path.join(releaseDir, name);
    try {
      cpSync(src, dest, { force: true });
    } catch {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const fallbackName = name.replace(/\.exe$/i, `-${ts}.exe`);
      cpSync(src, path.join(releaseDir, fallbackName), { force: true });
    }
  }
}
