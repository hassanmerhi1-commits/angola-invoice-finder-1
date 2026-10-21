/**
 * latest-desktop.json next to the built installer (same 1.3.8, newer buildId).
 */
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const repo = 'hassanmerhi1-commits/angola-invoice-finder-1';
const tag = 'v1.3.8';

function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

let buildId = String(process.env.GITHUB_SHA || process.env.NEXOR_COMMIT || '').trim();
if (!buildId) {
  try {
    buildId = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    buildId = '';
  }
}
if (!buildId) {
  console.error('write-latest-desktop: no git commit / GITHUB_SHA');
  process.exit(1);
}

const exes = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((name) => /^NEXOR-ERP-1\.3\.8-x64\.exe$/i.test(name))
  : [];
if (!exes.length) {
  console.error('write-latest-desktop: release/NEXOR-ERP-1.3.8-x64.exe missing');
  process.exit(1);
}
const file = exes[0];
const abs = path.join(releaseDir, file);
const sha512 = await sha512File(abs);
const size = fs.statSync(abs).size;
const manifest = {
  schema: 1,
  product: 'nexor-erp',
  appVersion: '1.3.8',
  buildId,
  builtAt: new Date().toISOString(),
  file,
  sha512,
  size,
  url: `https://github.com/${repo}/releases/download/${tag}/${file}`,
};
fs.writeFileSync(path.join(releaseDir, 'latest-desktop.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`write-latest-desktop: ${file}  ${size} bytes  build=${buildId.slice(0, 7)}`);
