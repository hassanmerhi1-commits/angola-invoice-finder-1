/**
 * Shared "is this backend tree complete enough to start?" checks.
 * City servers have two copies: NSSM often runs C:\NEXOR ERP\backend (overlay)
 * while the installer also ships Program Files\NEXOR ERP\resources\backend.
 * A half-copied overlay (new server.js, missing routes) bricks NexorBackend.
 */
const fs = require('fs');
const path = require('path');

const REQUIRED_RUNTIME_RELS = [
  'src/server.js',
  'src/routes/consistency.js',
  'src/lib/sqlDialect.js',
  'scripts/lib/integrityRunner.js',
  'node_modules/dotenv',
];

function missingBackendFiles(backendDir, rels = REQUIRED_RUNTIME_RELS) {
  if (!backendDir) return rels.slice();
  return rels.filter((rel) => !fs.existsSync(path.join(backendDir, rel)));
}

function backendLooksComplete(backendDir, rels = REQUIRED_RUNTIME_RELS) {
  return missingBackendFiles(backendDir, rels).length === 0;
}

function requiredRouteRelsFromServerJs(serverJsPath) {
  if (!serverJsPath || !fs.existsSync(serverJsPath)) return [];
  const text = fs.readFileSync(serverJsPath, 'utf8');
  const rels = [];
  const seen = new Set();
  const re = /require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(text))) {
    const rel = `src/routes/${match[1]}.js`;
    if (seen.has(rel)) continue;
    seen.add(rel);
    rels.push(rel);
  }
  return rels;
}

function missingCopiedSrcFiles(extractSrcDir, destBackendDir) {
  const destServer = path.join(destBackendDir, 'src', 'server.js');
  const srcServer = path.join(extractSrcDir, 'server.js');
  const missing = [];
  if (!fs.existsSync(destServer)) missing.push('src/server.js');
  const routeRels = requiredRouteRelsFromServerJs(
    fs.existsSync(srcServer) ? srcServer : destServer,
  );
  for (const rel of routeRels) {
    if (!fs.existsSync(path.join(destBackendDir, rel))) missing.push(rel);
  }
  return missing;
}

function listPackagedBackendDirs() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const dirs = [
    path.join(pf, 'NEXOR ERP', 'resources', 'backend'),
    'C:\\Program Files\\NEXOR ERP\\resources\\backend',
    'C:\\Program Files (x86)\\NEXOR ERP\\resources\\backend',
  ];
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    const key = path.resolve(dir).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

function findPackagedCompleteBackend() {
  for (const dir of listPackagedBackendDirs()) {
    if (backendLooksComplete(dir)) return dir;
  }
  return null;
}

function assertCopiedSrcComplete(extractSrcDir, destBackendDir) {
  const missing = missingCopiedSrcFiles(extractSrcDir, destBackendDir);
  if (missing.length) {
    throw new Error(`Update copy is incomplete (missing ${missing[0]})`);
  }
  return destBackendDir;
}

module.exports = {
  REQUIRED_RUNTIME_RELS,
  missingBackendFiles,
  backendLooksComplete,
  requiredRouteRelsFromServerJs,
  missingCopiedSrcFiles,
  listPackagedBackendDirs,
  findPackagedCompleteBackend,
  assertCopiedSrcComplete,
};
