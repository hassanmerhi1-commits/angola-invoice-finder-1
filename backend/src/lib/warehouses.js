/**
 * Warehouse helpers — metadata entity separate from branch.
 * Stock ledger still keys stock_movements.warehouse_id = branch id.
 */
const crypto = require('crypto');

/**
 * Ensure the branch has at least one active warehouse (code MAIN, default).
 * @returns {{ id: string, created: boolean, code: string, name: string } | null}
 */
async function ensureDefaultWarehouse(dbOrClient, branchId, branchName = '') {
  const id = String(branchId || '').trim();
  if (!id) return null;

  const existing = await dbOrClient.query(
    `SELECT id, code, name FROM warehouses
     WHERE CAST(branch_id AS TEXT) = CAST($1 AS TEXT)
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [id],
  ).catch(() => ({ rows: [] }));

  if (existing.rows?.[0]) {
    return {
      id: String(existing.rows[0].id),
      created: false,
      code: existing.rows[0].code || 'MAIN',
      name: existing.rows[0].name || branchName || 'Main',
    };
  }

  const whId = crypto.randomUUID();
  const name = String(branchName || 'Main').trim() || 'Main';
  try {
    await dbOrClient.query(
      `INSERT INTO warehouses (id, branch_id, code, name, is_default, is_active)
       VALUES ($1, $2, 'MAIN', $3, true, true)`,
      [whId, id, name],
    );
  } catch (e) {
    // Table missing or unique race — re-read
    const again = await dbOrClient.query(
      `SELECT id, code, name FROM warehouses
       WHERE CAST(branch_id AS TEXT) = CAST($1 AS TEXT) LIMIT 1`,
      [id],
    ).catch(() => ({ rows: [] }));
    if (again.rows?.[0]) {
      return {
        id: String(again.rows[0].id),
        created: false,
        code: again.rows[0].code || 'MAIN',
        name: again.rows[0].name || name,
      };
    }
    throw e;
  }
  return { id: whId, created: true, code: 'MAIN', name };
}

async function listWarehousesForBranch(dbOrClient, branchId) {
  const id = String(branchId || '').trim();
  if (!id) return [];
  try {
    const r = await dbOrClient.query(
      `SELECT * FROM warehouses
       WHERE CAST(branch_id AS TEXT) = CAST($1 AS TEXT)
         AND COALESCE(is_active, true) = true
       ORDER BY is_default DESC, name ASC`,
      [id],
    );
    return r.rows || [];
  } catch {
    return [];
  }
}

async function resolveWarehouseMeta(dbOrClient, warehouseId, branchId, branchName) {
  const wid = String(warehouseId || '').trim();
  if (wid) {
    try {
      const r = await dbOrClient.query(
        `SELECT id, code, name, branch_id FROM warehouses WHERE id = $1 LIMIT 1`,
        [wid],
      );
      const row = r.rows?.[0];
      if (row) {
        const rowBranch = String(row.branch_id || '');
        if (branchId && rowBranch && rowBranch !== String(branchId)) {
          throw new Error('Warehouse does not belong to the selected branch');
        }
        return { id: String(row.id), name: row.name || row.code || '', code: row.code || '' };
      }
    } catch (e) {
      if (/does not belong/i.test(String(e.message))) throw e;
    }
  }
  const def = await ensureDefaultWarehouse(dbOrClient, branchId, branchName);
  if (!def) return { id: '', name: '', code: '' };
  return { id: def.id, name: def.name, code: def.code };
}

module.exports = {
  ensureDefaultWarehouse,
  listWarehousesForBranch,
  resolveWarehouseMeta,
};
