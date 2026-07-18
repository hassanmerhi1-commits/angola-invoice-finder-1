const jwt = require('jsonwebtoken');
const db = require('../db');
const { headOfficeBranchWhere, branchExistsWhere } = require('../lib/sqlDialect');
const { JWT_SECRET } = require('../jwtSecret');
const { getBearerToken } = require('./requireAdmin');

function normalizeIsMain(value) {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

function isHeadOfficeRole(role) {
  const r = String(role || '').toLowerCase();
  return r === 'admin' || r === 'manager';
}

/** Match UI looksLikeHeadOfficeBranch: is_main, code MAIN/SEDE*, or name contains "sede". */
function looksLikeHeadOfficeBranch(row) {
  if (!row) return false;
  if (normalizeIsMain(row.is_main)) return true;
  const code = String(row.code || '').trim().toUpperCase();
  const name = String(row.name || '').trim().toLowerCase();
  return code === 'MAIN' || code.startsWith('SEDE') || name.includes('sede');
}

async function loadHeadOfficeBranch() {
  const result = await db.query(
    `SELECT id, is_main, code, name
     FROM branches
     WHERE ${headOfficeBranchWhere(db)}
        OR UPPER(TRIM(COALESCE(code, ''))) = 'MAIN'
        OR UPPER(TRIM(COALESCE(code, ''))) LIKE 'SEDE%'
        OR LOWER(COALESCE(name, '')) LIKE '%sede%'
     ORDER BY
       CASE
         WHEN ${headOfficeBranchWhere(db)} THEN 0
         WHEN UPPER(TRIM(COALESCE(code, ''))) = 'MAIN' THEN 1
         WHEN UPPER(TRIM(COALESCE(code, ''))) LIKE 'SEDE%' THEN 2
         WHEN LOWER(COALESCE(name, '')) LIKE '%sede%' THEN 3
         ELSE 4
       END,
       created_at
     LIMIT 1`,
  );
  return result.rows[0] || null;
}

async function branchExists(branchId) {
  const id = String(branchId || '').trim();
  if (!id) return null;
  const result = await db.query(
    `SELECT id, is_main, code, name
     FROM branches
     WHERE id = $1 AND ${branchExistsWhere(db)}`,
    [id],
  );
  return result.rows[0] || null;
}

/**
 * Resolve branch scope for a user row. Admin/manager with missing or stale branch_id
 * inherit head office so list APIs are not locked to a non-existent branch.
 *
 * Aligns with UI canUserSwitchBranch:
 * - admin → never forceBranchId (may request consolidated / any branch)
 * - manager on HQ-like branch (is_main or SEDE name/code) → consolidated OK
 * - everyone else → locked to their branch
 */
async function buildBranchScopeFromUser(userRow, opts = {}) {
  const { persistFix = false } = opts;
  const role = String(userRow.role || '').toLowerCase();
  const headOfficeRole = isHeadOfficeRole(role);
  const isAdmin = role === 'admin';
  let branchId = userRow.branch_id ? String(userRow.branch_id).trim() : '';
  let branchRow = branchId ? await branchExists(branchId) : null;

  if (branchId && !branchRow && headOfficeRole) {
    branchId = '';
    branchRow = null;
  }

  if (headOfficeRole && !branchRow) {
    const main = await loadHeadOfficeBranch();
    if (main?.id) {
      branchId = String(main.id);
      branchRow = main;
      if (persistFix && userRow.id) {
        await db.query('UPDATE users SET branch_id = $1 WHERE id = $2', [branchId, userRow.id]);
      }
    }
  }

  const hqLike = looksLikeHeadOfficeBranch(branchRow);
  const isHeadOffice = !!(branchId && hqLike && headOfficeRole);
  const isGlobalAdmin = isAdmin && !branchId;
  /** Admin always; HQ manager; admin with no branch. Matches UI switch/consolidated rights. */
  const canUseConsolidated = isAdmin || isHeadOffice || isGlobalAdmin;

  return {
    userId: userRow.id,
    role: userRow.role,
    branchId: branchId || null,
    isHeadOffice,
    isGlobalAdmin,
    canUseConsolidated,
    /** Non–head-office users (incl. cashiers at sede): locked to their branch. */
    forceBranchId: branchId && !canUseConsolidated ? branchId : null,
  };
}

/** Normalize admin/manager branch_id on login and return the effective id for API responses. */
async function resolveAndPersistUserBranchId(userRow) {
  const scope = await buildBranchScopeFromUser(userRow, { persistFix: true });
  return scope.branchId;
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
      `SELECT u.id, u.role, u.branch_id
       FROM users u
       WHERE u.id = $1 AND COALESCE(u.is_active, 1) != 0`,
      [decoded.userId],
    );

    if (result.rows.length === 0) return next();

    req.branchScope = await buildBranchScopeFromUser(result.rows[0], { persistFix: true });
  } catch {
    /* ignore invalid token — route stays public */
  }

  return next();
}

/**
 * Resolve branchId for list queries (respects filial lock server-side).
 * @returns {string|null|undefined} branch UUID, null = all branches (head office only), undefined = no access
 */
function normalizeRequestedBranchId(requestedBranchId) {
  const raw = requestedBranchId != null ? String(requestedBranchId).trim() : '';
  if (!raw || raw === 'all') return '';
  return raw;
}

function resolveListBranchId(req, requestedBranchId) {
  const scope = req.branchScope;
  if (scope?.forceBranchId) {
    return scope.forceBranchId;
  }
  const raw = normalizeRequestedBranchId(requestedBranchId);
  if (raw) {
    if (scope?.forceBranchId && raw !== scope.forceBranchId) {
      return scope.forceBranchId;
    }
    return raw;
  }
  if (scope?.canUseConsolidated || scope?.isHeadOffice || scope?.isGlobalAdmin) return null;
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
  normalizeRequestedBranchId,
  resolveWarehouseId,
  normalizeIsMain,
  looksLikeHeadOfficeBranch,
  buildBranchScopeFromUser,
  resolveAndPersistUserBranchId,
};
