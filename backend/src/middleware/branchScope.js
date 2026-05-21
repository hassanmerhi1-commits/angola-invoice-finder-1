const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../jwtSecret');
const { getBearerToken } = require('./requireAdmin');

function normalizeIsMain(value) {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

/**
 * Optional auth: attaches branch scope from JWT user when present.
 * Filial-assigned users always get forceBranchId set.
 */
async function attachUserBranchScope(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await db.query(
      `SELECT u.id, u.role, u.branch_id, b.is_main
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id = $1 AND COALESCE(u.is_active, 1) != 0`,
      [decoded.userId],
    );

    if (result.rows.length === 0) return next();

    const row = result.rows[0];
    const branchId = row.branch_id ? String(row.branch_id).trim() : '';
    const isMain = normalizeIsMain(row.is_main);

    const role = String(row.role || '').toLowerCase();
    const isHeadOfficeRole = role === 'admin' || role === 'manager';
    const isHeadOffice = !!(branchId && isMain && isHeadOfficeRole);
    const isGlobalAdmin = role === 'admin' && !branchId;

    req.branchScope = {
      userId: row.id,
      role: row.role,
      branchId: branchId || null,
      isHeadOffice,
      isGlobalAdmin,
      /** Non–head-office users (incl. cashiers at sede): locked to their branch. */
      forceBranchId: branchId && !isHeadOffice ? branchId : null,
    };
  } catch {
    /* ignore invalid token — route stays public */
  }

  return next();
}

/**
 * Resolve branchId for list queries (respects filial lock server-side).
 * @returns {string|null|undefined} branch UUID, null = all branches (head office only), undefined = no access
 */
function resolveListBranchId(req, requestedBranchId) {
  const scope = req.branchScope;
  if (scope?.forceBranchId) {
    return scope.forceBranchId;
  }
  const raw = requestedBranchId != null ? String(requestedBranchId).trim() : '';
  if (raw) {
    if (scope?.forceBranchId && raw !== scope.forceBranchId) {
      return scope.forceBranchId;
    }
    return raw;
  }
  if (scope?.isHeadOffice || scope?.isGlobalAdmin) return null;
  if (scope?.branchId) return scope.branchId;
  if (scope) return undefined;
  return raw || undefined;
}

/** Warehouse / branch filter for stock movements (same rules as products). */
function resolveWarehouseId(req, requestedWarehouseId) {
  return resolveListBranchId(req, requestedWarehouseId);
}

module.exports = {
  attachUserBranchScope,
  resolveListBranchId,
  resolveWarehouseId,
  normalizeIsMain,
};
