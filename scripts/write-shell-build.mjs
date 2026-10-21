/**
 * Stamp the git commit into electron/shell-build.json so tills can tell
 * whether this desktop shell already has the city-UI cache.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let buildId = String(process.env.GITHUB_SHA || process.env.NEXOR_COMMIT || '').trim();
if (!buildId) {
  try {
    buildId = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    buildId = '';
  }
}
if (!buildId) {
  console.error('write-shell-build: no git commit / GITHUB_SHA');
  process.exit(1);
}
const out = path.join(root, 'electron', 'shell-build.json');
fs.writeFileSync(out, `${JSON.stringify({ buildId, writtenAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`write-shell-build: ${buildId.slice(0, 7)} -> electron/shell-build.json`);
