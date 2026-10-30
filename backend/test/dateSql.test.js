const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { normalizeSqlDate } = require('../src/lib/dateSql');

test('a DATE at local midnight keeps that calendar day', () => {
  const d = new Date(2026, 9, 30);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  assert.equal(normalizeSqlDate(d), `${d.getFullYear()}-${month}-${day}`);
});

test('Angola local midnight is not stored as the previous UTC day', () => {
  const script = `
    const { normalizeSqlDate } = require('./src/lib/dateSql');
    const d = new Date(2026, 9, 30);
    if (d.getTimezoneOffset() === 0) process.exit(2);
    const got = normalizeSqlDate(d);
    if (got !== '2026-10-30') {
      console.error(got);
      process.exit(1);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'Africa/Luanda' },
    encoding: 'utf8',
  });
  if (result.status === 2) return;
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
