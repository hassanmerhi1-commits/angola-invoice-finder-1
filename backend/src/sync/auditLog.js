/**
 * Append-only sync audit log (Phase B0).
 */
const crypto = require('crypto');
const db = require('../db');

let tableChecked = false;
let tableExists = false;

async function ensureTable() {
  if (tableChecked) return tableExists;
  tableChecked = true;
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      db.engine === 'postgres' ? ['sync_audit_log'] : ['sync_audit_log']
    );
    tableExists = r.rows.length > 0;
  } catch {
    tableExists = false;
  }
  return tableExists;
}

/**
 * @param {object} entry
 * @param {string} entry.source - e.g. city_server, shop_client, agt_worker, replicator
 * @param {string} entry.destination - agt, main, city_server
 * @param {string} entry.status - pending | processing | completed | failed
 */
async function logSyncAudit(entry) {
  if (!(await ensureTable())) return null;

  const id = crypto.randomUUID();
  const {
    syncEventId = null,
    eventType = null,
    entityType = null,
    entityId = null,
    branchId = null,
    source,
    destination,
    idempotencyKey = null,
    status,
    errorMessage = null,
  } = entry;

  if (!source || !destination || !status) return null;

  try {
    await db.query(
      `INSERT INTO sync_audit_log
       (id, sync_event_id, event_type, entity_type, entity_id, branch_id,
        source, destination, idempotency_key, status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        syncEventId,
        eventType,
        entityType,
        entityId,
        branchId,
        source,
        destination,
        idempotencyKey,
        status,
        errorMessage ? String(errorMessage).slice(0, 2000) : null,
      ]
    );
    return id;
  } catch (e) {
    console.warn('[SYNC AUDIT]', e.message);
    return null;
  }
}

async function fetchRecentAudit(limit = 20, branchId = null) {
  if (!(await ensureTable())) return [];
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 100);
  if (branchId) {
    const r = await db.query(
      `SELECT * FROM sync_audit_log WHERE branch_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [branchId, cap]
    );
    return r.rows;
  }
  const r = await db.query(
    `SELECT * FROM sync_audit_log ORDER BY created_at DESC LIMIT $1`,
    [cap]
  );
  return r.rows;
}

module.exports = { logSyncAudit, fetchRecentAudit, ensureTable };
