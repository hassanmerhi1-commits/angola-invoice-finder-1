#!/usr/bin/env node
/**
 * Checks that journal lines cannot be posted to another party's ledger account.
 * Runs on node:sqlite, so it needs no database server.
 *
 * Usage: node backend/scripts/test-entity-journal-guard.js
 */
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('crypto');

const sqlite = new DatabaseSync(':memory:');
const db = {
  engine: 'sqlite',
  async query(sql, params = []) {
    // Postgres allows $2 to appear twice; rebuild the arg list in order of appearance.
    const ordered = [];
    const text = sql.replace(/\$(\d+)/g, (_, n) => {
      ordered.push(params[Number(n) - 1]);
      return '?';
    });
    const stmt = sqlite.prepare(text);
    if (/^\s*(select|with)/i.test(text)) return { rows: stmt.all(...ordered), rowCount: 0 };
    const info = stmt.run(...ordered);
    return { rows: [], rowCount: Number(info.changes || 0) };
  },
};

sqlite.exec(`
  CREATE TABLE chart_of_accounts (
    id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, description TEXT,
    account_type TEXT, account_nature TEXT, parent_id TEXT, level INTEGER,
    is_header INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    opening_balance REAL DEFAULT 0, current_balance REAL DEFAULT 0,
    children_count INTEGER DEFAULT 0
  );
  CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT, nif TEXT);
  CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT, nif TEXT);
`);

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL  ${message}`);
    return false;
  }
  console.log(`ok    ${message}`);
  return true;
}

async function account(code, name, opts = {}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO chart_of_accounts (id, code, name, description, account_type, account_nature, level, is_header, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 1)`,
    [
      id, code, name, opts.description || '',
      opts.type || 'liability', opts.nature || 'credit', code.length <= 3 ? 2 : 3,
    ],
  );
  return id;
}

async function main() {
  const { alignEntityJournalAccounts } = require('../src/lib/entityJournalGuard');

  await account('321', 'Fornecedores - correntes', { type: 'liability', nature: 'credit' });
  await account('311', 'Clientes - correntes', { type: 'asset', nature: 'debit' });
  await account('32100008', 'ABRICOME', { description: 'NIF: 32100089' });
  await account('32100275', 'BASEL ANGOLA', { description: 'NIF: 3210008' });
  await account('31100004', 'JOSE SILVA', { type: 'asset', nature: 'debit' });
  await account('31100010', 'MARIA COSTA', { type: 'asset', nature: 'debit' });
  await account('212', 'Mercadorias', { type: 'asset', nature: 'debit' });

  const baselId = randomUUID();
  await db.query(`INSERT INTO suppliers (id, name, nif) VALUES ($1, 'BASEL ANGOLA', '3210008')`, [baselId]);
  const mariaId = randomUUID();
  await db.query(`INSERT INTO clients (id, name, nif) VALUES ($1, 'MARIA COSTA', '3110010')`, [mariaId]);

  // 1. A purchase for BASEL ANGOLA arriving with ABRICOME's code.
  let lines = [
    { accountCode: '212', debit: 1000, credit: 0 },
    { accountCode: '32100008', debit: 0, credit: 1000 },
  ];
  let warnings = [];
  let changed = await alignEntityJournalAccounts(
    db, lines, { entityType: 'supplier', entityId: baselId, entityName: 'BASEL ANGOLA' }, warnings,
  );
  assert(changed === 1, `wrong supplier code is corrected (changed=${changed})`);
  assert(lines[1].accountCode === '32100275', `credit re-pointed to BASEL ANGOLA (${lines[1].accountCode})`);
  assert(lines[0].accountCode === '212', 'the goods line is untouched');
  assert(warnings.length === 1 && /ABRICOME/.test(warnings[0]), `a warning names the wrong account (${warnings[0]})`);

  // 2. The correct code is left alone.
  lines = [{ accountCode: '32100275', debit: 0, credit: 1000 }];
  warnings = [];
  changed = await alignEntityJournalAccounts(
    db, lines, { entityType: 'supplier', entityId: baselId, entityName: 'BASEL ANGOLA' }, warnings,
  );
  assert(changed === 0 && lines[0].accountCode === '32100275', 'a correct code is not rewritten');
  assert(warnings.length === 0, 'no warning when the code is right');

  // 3. A manual journal with no party context is the accountant's choice.
  lines = [{ accountCode: '32100008', debit: 0, credit: 500 }];
  changed = await alignEntityJournalAccounts(db, lines, {}, []);
  assert(changed === 0 && lines[0].accountCode === '32100008', 'a journal with no party is left alone');

  // 4. A supplier's identity must not touch a customer line.
  lines = [{ accountCode: '31100004', debit: 700, credit: 0 }];
  changed = await alignEntityJournalAccounts(
    db, lines, { entityType: 'supplier', entityId: baselId, entityName: 'BASEL ANGOLA' }, [],
  );
  assert(changed === 0 && lines[0].accountCode === '31100004', 'a customer line is not judged by a supplier');

  // 5. A receipt from MARIA COSTA carrying JOSE SILVA's code.
  lines = [
    { accountCode: '431', debit: 700, credit: 0 },
    { accountCode: '31100004', debit: 0, credit: 700 },
  ];
  warnings = [];
  changed = await alignEntityJournalAccounts(
    db, lines, { entityType: 'customer', entityId: mariaId, entityName: 'MARIA COSTA' }, warnings,
  );
  assert(changed === 1 && lines[1].accountCode === '31100010', `wrong customer code is corrected (${lines[1].accountCode})`);

  // 6. Without a declared kind the guard reuses an existing account and never invents one.
  const before = Number((await db.query(`SELECT COUNT(*) AS n FROM chart_of_accounts`)).rows[0].n);
  lines = [{ accountCode: '32100008', debit: 0, credit: 900 }];
  changed = await alignEntityJournalAccounts(db, lines, { entityName: 'BASEL ANGOLA' }, []);
  assert(changed === 1 && lines[0].accountCode === '32100275', 'inferred kind still corrects to the right account');
  lines = [{ accountCode: '32100008', debit: 0, credit: 900 }];
  changed = await alignEntityJournalAccounts(db, lines, { entityName: 'FORNECEDOR QUE NAO EXISTE' }, []);
  const after = Number((await db.query(`SELECT COUNT(*) AS n FROM chart_of_accounts`)).rows[0].n);
  assert(changed === 0, 'an unknown party with no declared kind is left alone');
  assert(after === before, 'no account is invented for an unknown party');

  console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
