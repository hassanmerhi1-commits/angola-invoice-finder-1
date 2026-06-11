/**
 * Unified fiscal audit logging → audit_log table (Audit Trail UI).
 */
const crypto = require('crypto');
const db = require('../db');

function workstationFromReq(req) {
  if (!req) return null;
  return (
    req.headers['x-workstation-id']
    || req.headers['x-client-id']
    || req.headers['x-machine-name']
    || null
  );
}

function ipFromReq(req) {
  if (!req) return null;
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || null;
}

function userFromReq(req, overrides = {}) {
  return {
    userId: overrides.userId || req?.user?.id || null,
    userName: overrides.userName || req?.user?.name || overrides.userName || 'System',
    branchId: overrides.branchId || req?.user?.branchId || null,
  };
}

/**
 * Log a fiscal event to audit_log (non-transactional — safe for route handlers).
 */
async function logFiscalEvent(params) {
  const {
    tableName,
    recordId,
    action,
    userId,
    userName,
    branchId,
    description,
    oldValues,
    newValues,
    metadata,
    workstationId,
    ipAddress,
  } = params;

  const id = crypto.randomUUID();
  const meta = {
    ...(metadata || {}),
    ...(workstationId ? { workstationId } : {}),
    ...(ipAddress ? { ipAddress } : {}),
  };

  const baseParams = [
    id,
    tableName || 'fiscal',
    recordId || null,
    action,
    userId,
    userName,
    branchId,
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    description,
  ];

  try {
    await db.query(
      `INSERT INTO audit_log (
        id, table_name, record_id, action, user_id, user_name, branch_id,
        old_values, new_values, description, metadata, workstation_id, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        ...baseParams,
        Object.keys(meta).length ? JSON.stringify(meta) : null,
        workstationId || null,
        ipAddress || null,
      ],
    );
    return id;
  } catch (err) {
    try {
      await db.query(
        `INSERT INTO audit_log (
          id, table_name, record_id, action, user_id, user_name, branch_id,
          old_values, new_values, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        baseParams,
      );
      return id;
    } catch (fallbackErr) {
      console.warn('[FISCAL AUDIT] Log skipped:', fallbackErr.message, `(action=${action})`);
      return null;
    }
  }
}

async function logFiscalEventFromReq(req, params) {
  const user = userFromReq(req, params);
  return logFiscalEvent({
    ...params,
    userId: params.userId ?? user.userId,
    userName: params.userName ?? user.userName,
    branchId: params.branchId ?? user.branchId,
    workstationId: params.workstationId ?? workstationFromReq(req),
    ipAddress: params.ipAddress ?? ipFromReq(req),
  });
}

module.exports = {
  logFiscalEvent,
  logFiscalEventFromReq,
  workstationFromReq,
  ipFromReq,
};
