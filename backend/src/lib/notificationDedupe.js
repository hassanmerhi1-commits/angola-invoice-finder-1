function overdueDocKey(entityId, documentNumber) {
  const entity = String(entityId || '').trim();
  const doc = String(documentNumber || '').trim() || entity;
  return `${entity}:${doc}`;
}

function overdueDedupeKey(entityId, documentNumber) {
  return `overdue_ar:${overdueDocKey(entityId, documentNumber)}`;
}

/**
 * One invoice, one key. Older keys ended with the day, so the same invoice
 * was added again every day and the old line stayed.
 */
function overdueIdentityFromDedupe(dedupeKey) {
  const parts = String(dedupeKey || '').split(':');
  if (parts[0] !== 'overdue_ar' || parts.length < 3) return null;
  const last = parts[parts.length - 1];
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(last);
  const body = dated ? parts.slice(1, -1) : parts.slice(1);
  if (body.length < 2) return null;
  const entityId = body[0];
  const doc = body.slice(1).join(':');
  if (!entityId || !doc) return null;
  return `${entityId}:${doc}`;
}

function periodDedupeKey(periodId) {
  return `period_close:${String(periodId || '').trim()}`;
}

function agtDedupeKey(entityType, entityId) {
  return `agt_fail:${entityType || 'x'}:${entityId || 'x'}`;
}

module.exports = {
  overdueDocKey,
  overdueDedupeKey,
  overdueIdentityFromDedupe,
  periodDedupeKey,
  agtDedupeKey,
};
