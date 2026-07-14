/**
 * Pro-ERP audit helpers — write significant business events to audit_log
 * (Auditoria / Audit Trail). Prefer this for HTTP route handlers.
 *
 * Accounting journals (GL) stay in createJournalEntry / transactionEngine.
 * Rule: Journals = money/stock value; Auditoria = who did what when.
 */
const { logFiscalEvent, logFiscalEventFromReq } = require('./fiscalAudit');

/**
 * @param {import('express').Request|null} req
 * @param {{
 *   table: string,
 *   id?: string|null,
 *   action: string,
 *   description: string,
 *   oldValues?: object|null,
 *   newValues?: object|null,
 *   metadata?: object|null,
 *   branchId?: string|null,
 *   userId?: string|null,
 *   userName?: string|null,
 * }} opts
 */
async function auditErp(req, opts) {
  const {
    table,
    id,
    action,
    description,
    oldValues,
    newValues,
    metadata,
    branchId,
    userId,
    userName,
  } = opts;
  if (!action || !table) return null;
  try {
    if (req) {
      return await logFiscalEventFromReq(req, {
        tableName: table,
        recordId: id || null,
        action,
        description,
        oldValues: oldValues || null,
        newValues: newValues || null,
        metadata: metadata || null,
        branchId: branchId || undefined,
        userId: userId || undefined,
        userName: userName || undefined,
      });
    }
    return await logFiscalEvent({
      tableName: table,
      recordId: id || null,
      action,
      description,
      oldValues: oldValues || null,
      newValues: newValues || null,
      metadata: metadata || null,
      branchId: branchId || null,
      userId: userId || null,
      userName: userName || 'System',
    });
  } catch (err) {
    console.warn('[ERP AUDIT] skipped:', err.message, `(${table}/${action})`);
    return null;
  }
}

/** Fire-and-forget wrapper so audit never blocks the HTTP response path. */
function auditErpSafe(req, opts) {
  void auditErp(req, opts);
}

module.exports = {
  auditErp,
  auditErpSafe,
  logFiscalEvent,
  logFiscalEventFromReq,
};
