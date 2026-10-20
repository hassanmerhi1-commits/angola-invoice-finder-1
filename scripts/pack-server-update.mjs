/**
 * Build nexor-server-update.zip + latest-server.json for the v1.3.8 release.
 * Run after `npm run build:webapp`. Does not bump the AGT version.
 */
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webapp = path.join(root, 'backend', 'webapp');
const backendSrc = path.join(root, 'backend', 'src');
const outDir = path.join(root, 'release');
const staging = path.join(outDir, 'server-update-staging');

const PRODUCT = 'nexor-erp';
const APP_VERSION = '1.3.8';
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'test', 'tests', '__tests__']);
const SKIP_FILE_NAMES = new Set(['.env', '.env.local', 'database.env', '.ds_store']);
const ALLOWED_EXT = new Set([
  '.js', '.cjs', '.mjs', '.sql', '.json', '.html', '.css',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.map', '.txt', '.md', '.ps1',
]);

function readCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.trim();
  if (process.env.NEXOR_COMMIT) return process.env.NEXOR_COMMIT.trim();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function copyFiltered(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (SKIP_FILE_NAMES.has(name.toLowerCase())) continue;
    const src = path.join(from, name);
    const dest = path.join(to, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      if (SKIP_DIR_NAMES.has(name.toLowerCase())) continue;
      copyFiltered(src, dest);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (ext && !ALLOWED_EXT.has(ext)) continue;
    if (/\.(pfx|pem|key|p12|exe|dll|node)$/i.test(name)) continue;
    fs.copyFileSync(src, dest);
  }
}

function fail(message) {
  console.error(`pack-server-update: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(webapp, 'index.html'))) {
  fail('backend/webapp/index.html is missing — run npm run build:webapp first');
}
if (!fs.existsSync(path.join(backendSrc, 'server.js'))) {
  fail('backend/src/server.js is missing');
}

const commit = readCommit();
if (!commit) fail('Could not resolve git commit / GITHUB_SHA for the build stamp');

const builtAt = new Date().toISOString();
const stamp = {
  product: PRODUCT,
  appVersion: APP_VERSION,
  commit,
  buildId: commit,
  builtAt,
};

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(path.join(staging, 'backend', 'scripts'), { recursive: true });
fs.mkdirSync(path.join(staging, 'scripts'), { recursive: true });

copyFiltered(webapp, path.join(staging, 'webapp'));
copyFiltered(backendSrc, path.join(staging, 'backend', 'src'));
fs.copyFileSync(path.join(root, 'backend', 'package.json'), path.join(staging, 'backend', 'package.json'));
const lockPath = path.join(root, 'backend', 'package-lock.json');
if (fs.existsSync(lockPath)) {
  fs.copyFileSync(lockPath, path.join(staging, 'backend', 'package-lock.json'));
}
const ensure = path.join(root, 'backend', 'scripts', 'ensure-server-schema.js');
if (fs.existsSync(ensure)) {
  fs.copyFileSync(ensure, path.join(staging, 'backend', 'scripts', 'ensure-server-schema.js'));
}
const applyScript = path.join(root, 'scripts', 'apply-nexor-server-update.ps1');
if (fs.existsSync(applyScript)) {
  fs.copyFileSync(applyScript, path.join(staging, 'scripts', 'apply-nexor-server-update.ps1'));
}
const finishScript = path.join(root, 'scripts', 'finish-nexor-server-update.ps1');
if (fs.existsSync(finishScript)) {
  fs.copyFileSync(finishScript, path.join(staging, 'scripts', 'finish-nexor-server-update.ps1'));
}

fs.writeFileSync(path.join(staging, 'backend', 'BUILD_STAMP.json'), `${JSON.stringify(stamp, null, 2)}\n`);
fs.writeFileSync(
  path.join(staging, 'webapp', 'build.json'),
  `${JSON.stringify({ version: APP_VERSION, commit, builtAt }, null, 2)}\n`,
);

const repo = process.env.NEXOR_UPDATE_REPO || 'hassanmerhi1-commits/angola-invoice-finder-1';
const tag = process.env.NEXOR_UPDATE_TAG || 'v1.3.8';
const fileName = 'nexor-server-update.zip';

// sha512 lives only in latest-server.json (hashing a zip that contains its own
// hash cannot converge). The inner manifest is identity + allowlist data.
const innerManifest = {
  schema: 1,
  product: PRODUCT,
  appVersion: APP_VERSION,
  buildId: commit,
  buildIdShort: commit.slice(0, 7),
  builtAt,
  file: fileName,
};
fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(innerManifest, null, 2)}\n`);

fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, fileName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', staging, '.'], { cwd: root, stdio: 'inherit' });

const zipBuf = fs.readFileSync(zipPath);
const manifest = {
  ...innerManifest,
  sha512: crypto.createHash('sha512').update(zipBuf).digest('hex'),
  size: zipBuf.length,
  url: `https://github.com/${repo}/releases/download/${tag}/${fileName}`,
};
fs.writeFileSync(path.join(outDir, 'latest-server.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`pack-server-update: ${fileName}  ${manifest.size} bytes  sha512=${manifest.sha512.slice(0, 16)}…  build=${commit.slice(0, 7)}`);
