/**
 * SQLite stores many flags as INTEGER 0/1; PostgreSQL uses BOOLEAN.
 * Use these helpers in shared SQL strings.
 */
function activeUserWhere(db) {
  if (db.engine === 'postgres') {
    return '(is_active IS NULL OR is_active = TRUE)';
  }
  return `(is_active IS NULL OR is_active = 1 OR is_active = true OR is_active = '1' OR is_active = 'true')`;
}

function activeFlagWhere(db, column = 'is_active') {
  if (db.engine === 'postgres') {
    return `(${column} IS NULL OR ${column} IS NOT FALSE)`;
  }
  return `(${column} IS NULL OR ${column} IS NOT FALSE AND ${column} != 0)`;
}

function mainBranchWhere(db) {
  if (db.engine === 'postgres') {
    return '(is_main = TRUE)';
  }
  return '(is_main = 1 OR is_main = true)';
}

/** branches table: is_active exists on SQLite bootstrap, not on PG migration 001. */
function branchesListSql(db) {
  if (db.engine === 'postgres') {
    return 'SELECT * FROM branches ORDER BY is_main DESC, name';
  }
  return 'SELECT * FROM branches WHERE COALESCE(is_active, 1) != 0 ORDER BY is_main DESC, name';
}

/** SQLite: COALESCE(flag, 1) != 0 — invalid on PG boolean columns. */
function coalesceActiveNotZero(db, column = 'is_active') {
  if (db.engine === 'postgres') {
    return `(${column} IS NULL OR ${column} IS NOT FALSE)`;
  }
  return `COALESCE(${column}, 1) != 0`;
}

/** SQLite: COALESCE(is_main, 0) != 0 */
function coalesceMainTruthy(db, column = 'is_main') {
  if (db.engine === 'postgres') {
    return `(${column} IS TRUE)`;
  }
  return `COALESCE(${column}, 0) != 0`;
}

function openItemIsDebitSql(db, alias = 'oi') {
  const col = `${alias}.is_debit`;
  if (db.engine === 'postgres') {
    return `(${col} IS TRUE)`;
  }
  return `(${col} = 1 OR ${col} = TRUE OR ${col} = '1' OR LOWER(CAST(${col} AS TEXT)) = 'true')`;
}

function openItemDebitAmountCase(db, alias = 'oi', amountCol = 'remaining_amount') {
  const debit = openItemIsDebitSql(db, alias);
  return `CASE WHEN ${debit} THEN ${alias}.${amountCol} ELSE -${alias}.${amountCol} END`;
}

/** branchScope: head office row when branches lack is_active (PG). */
function headOfficeBranchWhere(db) {
  if (db.engine === 'postgres') {
    return '(is_main IS TRUE)';
  }
  return 'COALESCE(is_main, 0) != 0 AND COALESCE(is_active, 1) != 0';
}

function branchExistsWhere(db) {
  if (db.engine === 'postgres') {
    return 'TRUE';
  }
  return 'COALESCE(is_active, 1) != 0';
}

/** ORDER BY active rows first (not a WHERE clause). */
/** SQLite allows MAX(a,b); PostgreSQL needs GREATEST(a,b). */
/** Catalog / HQ row: branch_id NULL (PG UUID cannot TRIM to ''). */
function emptyBranchIdClause(db, column = 'branch_id') {
  if (db.engine === 'postgres') {
    return `(${column} IS NULL)`;
  }
  return `(${column} IS NULL OR TRIM(COALESCE(${column}, '')) = '')`;
}

function catalogBranchScopeClause(db, alias, mainInSql) {
  const col = `${alias}.branch_id`;
  const empty = emptyBranchIdClause(db, col);
  if (mainInSql && mainInSql !== "''") {
    return `(${empty} OR ${col} IN (${mainInSql}))`;
  }
  return empty;
}

function sqlScalarMax(db, leftExpr, rightExpr) {
  if (db.engine === 'postgres') {
    return `GREATEST((${leftExpr})::numeric, (${rightExpr})::numeric)`;
  }
  return `MAX(${leftExpr}, ${rightExpr})`;
}

function orderByActiveDesc(db, column = 'is_active') {
  if (db.engine === 'postgres') {
    return `(CASE WHEN ${column} IS NOT FALSE THEN 1 ELSE 0 END)`;
  }
  return `COALESCE(${column}, 1)`;
}

module.exports = {
  activeUserWhere,
  activeFlagWhere,
  mainBranchWhere,
  branchesListSql,
  coalesceActiveNotZero,
  coalesceMainTruthy,
  openItemIsDebitSql,
  openItemDebitAmountCase,
  headOfficeBranchWhere,
  branchExistsWhere,
  orderByActiveDesc,
  sqlScalarMax,
  emptyBranchIdClause,
  catalogBranchScopeClause,
};
