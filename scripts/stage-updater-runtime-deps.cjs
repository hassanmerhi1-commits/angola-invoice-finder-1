/**
 * Copy electron-updater and all transitive runtime dependencies into build/updater-runtime-deps.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcNodeModules = path.join(root, 'node_modules');
const outNodeModules = path.join(root, 'build', 'updater-runtime-deps', 'node_modules');

const ROOT_PACKAGES = ['electron-updater'];

function rim(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function resolvePackageDir(name, fromDir = srcNodeModules) {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/');
    const dir = path.join(fromDir, scope, pkg);
    return fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
  }
  const dir = path.join(fromDir, name);
  return fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
}

function readDeps(packageDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  return Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
}

function collectPackages() {
  const queue = [...ROOT_PACKAGES];
  const seen = new Set();
  const dirs = new Map();

  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);

    let dir = resolvePackageDir(name);
    if (!dir) {
      // nested dependency inside an already-seen package
      for (const knownDir of dirs.values()) {
        dir = resolvePackageDir(name, path.join(knownDir, 'node_modules'));
        if (dir) break;
      }
    }
    if (!dir) {
      console.warn(`[stage-updater-runtime-deps] warning: could not resolve "${name}"`);
      continue;
    }

    dirs.set(name, dir);
    for (const dep of readDeps(dir)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }

  return dirs;
}

function copyPackage(name, srcDir) {
  const rel = name.startsWith('@') ? name : name;
  const dest = path.join(outNodeModules, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(srcDir, dest, {
    recursive: true,
    filter: (entry) => !entry.split(path.sep).includes('.bin'),
  });
}

rim(path.join(root, 'build', 'updater-runtime-deps'));
fs.mkdirSync(outNodeModules, { recursive: true });

const packages = collectPackages();
if (!packages.has('electron-updater')) {
  console.error('[stage-updater-runtime-deps] electron-updater not found — run npm install');
  process.exit(1);
}

for (const [name, dir] of packages) {
  copyPackage(name, dir);
}

const required = [
  'electron-updater',
  'builder-util-runtime',
  'debug',
  'ms',
  'tiny-typed-emitter',
  'lodash.escaperegexp',
];
for (const pkg of required) {
  if (!fs.existsSync(path.join(outNodeModules, pkg, 'package.json'))) {
    console.error(`[stage-updater-runtime-deps] missing required package "${pkg}" after staging`);
    process.exit(1);
  }
}

console.log(
  `[stage-updater-runtime-deps] OK — staged ${packages.size} packages to build/updater-runtime-deps/node_modules`,
);
