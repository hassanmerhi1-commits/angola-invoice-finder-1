/**
 * Rebuild backend native addons (better-sqlite3) for Electron's Node ABI.
 * The desktop app runs backend/src/server.js with the **Electron** binary and
 * ELECTRON_RUN_AS_NODE=1 (see electron/backendManager.cjs). A plain `npm install`
 * in backend/ produces a .node for system Node and will not load in that child.
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const backendRoot = path.join(root, 'backend');
const nm = path.join(backendRoot, 'node_modules');

if (!fs.existsSync(path.join(backendRoot, 'package.json'))) {
  console.error('[rebuild-backend-native] Missing backend/package.json');
  process.exit(1);
}
if (!fs.existsSync(nm)) {
  console.error('[rebuild-backend-native] Run: cd backend && npm install');
  process.exit(1);
}

const require = createRequire(import.meta.url);
let electronVersion;
try {
  electronVersion = require('electron/package.json').version;
} catch {
  console.error('[rebuild-backend-native] Install root devDependency `electron` (npm install).');
  process.exit(1);
}

console.log(
  `[rebuild-backend-native] Rebuilding better-sqlite3 for Electron ${electronVersion} (module-dir=backend)…`
);

const cmd = `npx --yes @electron/rebuild -f -w better-sqlite3 -v ${electronVersion} --module-dir "${backendRoot}"`;
try {
  execSync(cmd, { stdio: 'inherit', cwd: root, env: process.env, shell: true });
} catch {
  console.error(
    '[rebuild-backend-native] FAILED. Close other apps using backend\\node_modules, then retry.\n' +
      '  If EPERM on Windows: close NEXOR ERP / VS Code handles on better_sqlite3.node, then run again.'
  );
  process.exit(1);
}

console.log('[rebuild-backend-native] OK');
