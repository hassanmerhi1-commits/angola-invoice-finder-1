/**
 * One-shot: drain redundant main queue on HQ (legacy destinations JSON rows).
 * Usage: cd C:\NEXOR ERP\backend && node scripts/drain-hq-queue.js
 */
const path = require('path');
const fs = require('fs');

const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
const envPath = path.join(installDir, 'database.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

require('../src/db');
const { drainRedundantMainQueueOnHq } = require('../src/sync/outbox');

drainRedundantMainQueueOnHq()
  .then((n) => {
    console.log('Drained rows:', n);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
