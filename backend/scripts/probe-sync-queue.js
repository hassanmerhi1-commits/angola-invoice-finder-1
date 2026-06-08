require('../src/db');
const db = require('../src/db');

(async () => {
  const cfg = await require('../src/sync/installation').getInstallationConfig(true);
  console.log('installation', { role: cfg.role, isMainServer: cfg.isMainServer });

  const pending = await db.query(
    `SELECT id, event_type, destination, destinations, status, idempotency_key, branch_id, created_at
     FROM sync_events WHERE status IN ('pending', 'failed') ORDER BY created_at`
  );
  console.log('pending count', pending.rows.length);
  for (const row of pending.rows) {
    console.log(row);
  }

  const { drainRedundantMainQueueOnHq } = require('../src/sync/outbox');
  const drained = await drainRedundantMainQueueOnHq();
  console.log('drained', drained);

  const after = await db.query(
    `SELECT id, event_type, destination, status FROM sync_events WHERE status IN ('pending', 'failed')`
  );
  console.log('after count', after.rows.length);
  for (const row of after.rows) console.log(row);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
