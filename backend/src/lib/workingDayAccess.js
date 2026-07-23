/**
 * Working-day / backdate checks for API routes (mirrors src/lib/workingDayAccess.ts).
 */
const { userHasPermission } = require('./rolePermissions');

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toISODateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) return localISODate(value);
  return String(value).slice(0, 10);
}

function isBeforeToday(isoDate) {
  const day = toISODateOnly(isoDate);
  if (!day) return false;
  return day < localISODate();
}

function canUsePostingDate(user, isoDate) {
  if (!isBeforeToday(isoDate)) return true;
  if (!user) return false;
  return userHasPermission(user.role, user.permissionOverrides, 'backdate_post');
}

function canEditRecordDated(user, isoDate) {
  if (!isBeforeToday(isoDate)) return true;
  if (!user) return false;
  return userHasPermission(user.role, user.permissionOverrides, 'edit_historical');
}

function assertCanUsePostingDate(user, isoDate) {
  if (canUsePostingDate(user, isoDate)) return;
  const err = new Error(
    'Sem permissão para lançar com data anterior a hoje (backdate_post).',
  );
  err.status = 403;
  err.code = 'BACKDATE_DENIED';
  throw err;
}

function assertCanEditHistorical(user, isoDate) {
  if (canEditRecordDated(user, isoDate)) return;
  const err = new Error(
    'Sem permissão para editar registos com data anterior a hoje (edit_historical).',
  );
  err.status = 403;
  err.code = 'EDIT_HISTORICAL_DENIED';
  throw err;
}

module.exports = {
  localISODate,
  toISODateOnly,
  isBeforeToday,
  canUsePostingDate,
  canEditRecordDated,
  assertCanUsePostingDate,
  assertCanEditHistorical,
};
