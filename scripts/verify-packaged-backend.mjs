/**
 * Fail the build if win-unpacked does not contain the unified SQLite Express stack.
 * Run after electron-builder so release/win-unpacked matches backend/src/server.js.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
// Optional argv: path to win-unpacked (e.g. TEMP build output). Default: release/win-unpacked
const unpackRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'release', 'win-unpacked');
const serverJs = path.join(unpackRoot, 'resources', 'backend', 'src', 'server.js');
const dbJs = path.join(unpackRoot, 'resources', 'backend', 'src', 'db.js');

if (!fs.existsSync(serverJs)) {
  console.error('[verify-packaged-backend] Missing packaged server:', serverJs);
  process.exit(2);
}

const server = fs.readFileSync(serverJs, 'utf8');

const isUnifiedSqlite =
  server.includes('SQLite unified') &&
  server.includes("require('./db')") &&
  server.includes('/api/products');

if (!isUnifiedSqlite) {
  console.error(
    '[verify-packaged-backend] Packaged server.js is not the unified SQLite stack (expect "SQLite unified", require(./db), /api/products).'
  );
  process.exit(1);
}

// Legacy minimal / wrong tree: old KWANZA-only banner without unified markers
if (server.includes('KWANZA ERP SERVER') && !server.includes('SQLite unified')) {
  console.error('[verify-packaged-backend] Packaged server.js looks like the old KWANZA minimal server.');
  process.exit(1);
}

if (!fs.existsSync(dbJs)) {
  console.error('[verify-packaged-backend] Missing packaged db.js:', dbJs);
  process.exit(2);
}

const db = fs.readFileSync(dbJs, 'utf8');
if (db.includes("require('pg')") || db.includes('require("pg")')) {
  console.error('[verify-packaged-backend] Packaged db.js still requires pg — backend tree is stale.');
  process.exit(1);
}
if (!db.includes('better-sqlite3')) {
  console.error('[verify-packaged-backend] Packaged db.js must use better-sqlite3.');
  process.exit(1);
}

console.log('[verify-packaged-backend] OK — unified SQLite backend packaged at', serverJs);
