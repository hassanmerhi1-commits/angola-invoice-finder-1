#!/usr/bin/env node
/**
 * Checks that every account handed to the chart tree actually renders somewhere.
 * A row registered under a parent that is not in the list used to vanish, which is
 * what happened to search results whose parent did not match the term.
 *
 * Usage: node scripts/test-coa-tree.mjs
 */
import { buildSync } from 'esbuild';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';

const outfile = path.join(os.tmpdir(), `coa-tree-${Date.now()}.cjs`);
buildSync({
  entryPoints: ['src/lib/coaTreeBalances.ts'],
  outfile,
  format: 'cjs',
  platform: 'node',
  loader: { '.ts': 'ts' },
});
const require = createRequire(import.meta.url);
const { buildVisibleCoaForest, coaIdKey } = require(outfile);

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

const account = (id, code, name, parent_id = null) => ({
  id, code, name, parent_id,
  is_header: code.length <= 2,
  account_type: 'liability',
  account_nature: 'credit',
  current_balance: 0,
  opening_balance: 0,
  level: code.length <= 2 ? 1 : 2,
});

/** Every input row must be reachable from the roots. */
function reachable(forest, accounts) {
  const seen = new Set();
  const walk = (row) => {
    const key = coaIdKey(row.id);
    if (seen.has(key)) return;
    seen.add(key);
    for (const kid of forest.childrenByParent.get(key) || []) walk(kid);
  };
  for (const root of forest.roots) walk(root);
  return accounts.filter((a) => !seen.has(coaIdKey(a.id)));
}

const GROUP = 'g-32';
const PARENT = 'p-321';
const BASEL = 'l-basel';

// 1. The full branch: nesting still works.
let rows = [
  account(GROUP, '32', 'Fornecedores'),
  account(PARENT, '321', 'Fornecedores - correntes', GROUP),
  account(BASEL, '32100275', 'BASEL ANGOLA', PARENT),
];
let forest = buildVisibleCoaForest(rows);
assert(forest.roots.length === 1 && forest.roots[0].id === GROUP, 'full branch has one root');
assert(
  (forest.childrenByParent.get(coaIdKey(PARENT)) || []).some((a) => a.id === BASEL),
  'BASEL ANGOLA nests under 321',
);
assert(reachable(forest, rows).length === 0, 'every row in the full branch is reachable');

// 2. The search case: the hit is kept but its parents are not.
rows = [account(BASEL, '32100275', 'BASEL ANGOLA', PARENT)];
forest = buildVisibleCoaForest(rows);
assert(forest.roots.length === 1 && forest.roots[0].id === BASEL, 'a hit with no parent present becomes a root');
assert(reachable(forest, rows).length === 0, 'the hit renders instead of vanishing');

// 3. A hit plus its ancestors, which is what the page now passes in.
rows = [
  account(PARENT, '321', 'Fornecedores - correntes', GROUP),
  account(BASEL, '32100275', 'BASEL ANGOLA', PARENT),
];
forest = buildVisibleCoaForest(rows);
assert(forest.roots.length === 1 && forest.roots[0].id === PARENT, 'the retained ancestor is the root');
assert(reachable(forest, rows).length === 0, 'hit and ancestor are both reachable');

// 4. A broken parent_id falls back to the closest ancestor by PGC code.
rows = [
  account(PARENT, '321', 'Fornecedores - correntes'),
  account(BASEL, '32100275', 'BASEL ANGOLA', 'does-not-exist'),
];
forest = buildVisibleCoaForest(rows);
assert(
  (forest.childrenByParent.get(coaIdKey(PARENT)) || []).some((a) => a.id === BASEL),
  'a broken parent_id nests by code prefix',
);
assert(reachable(forest, rows).length === 0, 'nothing is lost to a broken parent_id');

// 5. parent_id case differences must still nest.
rows = [
  account('P-ABC', '321', 'Fornecedores - correntes'),
  account(BASEL, '32100275', 'BASEL ANGOLA', 'p-abc'),
];
forest = buildVisibleCoaForest(rows);
assert(forest.roots.length === 1, 'a case-different parent_id still nests');
assert(reachable(forest, rows).length === 0, 'nothing is lost to id casing');

// 6. No row is ever dropped, whatever the shape.
rows = [
  account(GROUP, '32', 'Fornecedores'),
  account(PARENT, '321', 'Fornecedores - correntes', GROUP),
  account(BASEL, '32100275', 'BASEL ANGOLA', PARENT),
  account('orphan', '32100999', 'SEM PAI', 'missing'),
  account('loose', '999', 'Solta'),
];
forest = buildVisibleCoaForest(rows);
const lost = reachable(forest, rows);
assert(lost.length === 0, `no row is dropped (${lost.map((a) => a.code).join(', ') || 'none lost'})`);

try { fs.unlinkSync(outfile); } catch { /* temp file */ }
console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
process.exit(failures ? 1 : 0);
