#!/usr/bin/env node
/**
 * Inserts 2 demo suppliers into SQLite (same default path as backend/src/db.js).
 *
 * Usage (from backend folder):
 *   node scripts/seed-two-suppliers.js
 *   $env:SQLITE_PATH="C:\nexor\erp.db"; node scripts/seed-two-suppliers.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/** Same discovery order as desktop: explicit env → IP file → Roaming DB → default path */
function resolveSqlitePath() {
  if (process.env.SQLITE_PATH) {
    return path.resolve(process.env.SQLITE_PATH);
  }
  const ipFile = path.join('C:\\', 'NEXOR ERP', 'IP');
  try {
    if (fs.existsSync(ipFile)) {
      const content = fs.readFileSync(ipFile, 'utf8').trim();
      if (/^[A-Za-z]:\\.+\\.(nexor|db)$/i.test(content) && fs.existsSync(content)) {
        console.log('[seed] Using DB path from', ipFile);
        return content;
      }
    }
  } catch (e) {
    console.warn('[seed] Could not read IP file:', e.message);
  }
  const roaming = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'NEXOR ERP', 'erp.db')
    : null;
  if (roaming && fs.existsSync(roaming)) {
    console.log('[seed] Using Roaming userData DB:', roaming);
    return roaming;
  }
  return path.resolve('C:\\nexor\\erp.db');
}

const dbPath = resolveSqlitePath();

if (!fs.existsSync(dbPath)) {
  console.error('[seed] Database not found:', dbPath);
  console.error('       Set SQLITE_PATH to your .db file, or complete app Setup so the IP file points to a valid .db');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const t = Date.now();
const suppliers = [
  {
    name: 'Distribuidora Central Lda (Demo)',
    nif: `54${String(t).slice(-7)}1`,
    email: 'compras.distcentral@example.ao',
    phone: `+244 923 ${String(100000 + (t % 899999)).padStart(6, '0')}`,
    address: 'Rua Comandante Kwenha, 42',
    city: 'Luanda',
    country: 'Angola',
    contact_person: 'Maria Kitumba',
    payment_terms: '30_days',
    notes: 'Random seed A — NET 30; created by seed-two-suppliers.js',
  },
  {
    name: 'Importadora Sul Atlântico SA (Demo)',
    nif: `54${String(t + 1).slice(-7)}2`,
    email: 'fornecedor.sulatlantico@example.ao',
    phone: `+244 924 ${String(200000 + (t % 799999)).padStart(6, '0')}`,
    address: 'Via Expresso Viana, km 12',
    city: 'Viana',
    country: 'Angola',
    contact_person: 'João Capenda',
    payment_terms: '45_days',
    notes: 'Random seed B — bank transfer preferred; created by seed-two-suppliers.js',
  },
];

const insert = db.prepare(`
  INSERT INTO suppliers (name, nif, email, phone, address, city, country, contact_person, payment_terms, notes)
  VALUES (@name, @nif, @email, @phone, @address, @city, @country, @contact_person, @payment_terms, @notes)
`);

let ok = 0;
for (const s of suppliers) {
  try {
    insert.run(s);
    ok += 1;
    console.log('[seed] OK:', s.name, '| NIF', s.nif);
  } catch (e) {
    if (String(e.message).toLowerCase().includes('unique')) {
      console.warn('[seed] Skipped (duplicate NIF or name):', s.name, e.message);
    } else {
      console.error('[seed] Error:', s.name, e.message);
    }
  }
}

db.close();
console.log(`[seed] Done. Inserted ${ok}/2 rows into`, dbPath);
