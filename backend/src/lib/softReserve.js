/**
 * Soft holds from reserved / partially shipped sales orders (reserved_qty > 0).
 * Stock ledger still uses branch id as warehouse_id.
 */

async function loadReservedHoldsForBranch(db, branchId) {
  const branch = String(branchId || '').trim();
  const byProductId = new Map();
  const bySku = new Map();
  if (!branch) return { byProductId, bySku };

  try {
    const r = await db.query(
      `SELECT
         CAST(i.product_id AS TEXT) AS product_id,
         LOWER(TRIM(COALESCE(i.sku, ''))) AS sku,
         COALESCE(SUM(i.reserved_qty), 0) AS qty
       FROM sales_order_items i
       INNER JOIN sales_orders o ON o.id = i.sales_order_id
       WHERE o.status IN ('reserved', 'partially_shipped')
         AND CAST(o.branch_id AS TEXT) = CAST($1 AS TEXT)
         AND COALESCE(i.reserved_qty, 0) > 0
       GROUP BY CAST(i.product_id AS TEXT), LOWER(TRIM(COALESCE(i.sku, '')))`,
      [branch],
    );
    for (const row of r.rows || []) {
      const qty = Math.max(0, Number(row.qty) || 0);
      if (!qty) continue;
      const pid = String(row.product_id || '').trim();
      const sku = String(row.sku || '').trim().toLowerCase();
      if (pid) byProductId.set(pid, (byProductId.get(pid) || 0) + qty);
      if (sku) bySku.set(sku, (bySku.get(sku) || 0) + qty);
    }
  } catch (_) {
    // sales_orders missing on old DBs
  }
  return { byProductId, bySku };
}

function reservedQtyForProduct(holds, productId, sku) {
  if (!holds) return 0;
  const pid = String(productId || '').trim();
  const skuKey = String(sku || '').trim().toLowerCase();
  let qty = 0;
  if (pid && holds.byProductId.has(pid)) qty = Math.max(qty, holds.byProductId.get(pid) || 0);
  if (skuKey && holds.bySku.has(skuKey)) qty = Math.max(qty, holds.bySku.get(skuKey) || 0);
  return qty;
}

/** Mutate/map product-like rows: stock becomes available (onHand - reserved). */
function applySoftReservesToRows(rows, holds) {
  if (!Array.isArray(rows) || !holds) return rows || [];
  return rows.map((r) => {
    const onHand = Math.max(0, Number(r.stock) || 0);
    const reserved = reservedQtyForProduct(holds, r.id || r.product_id, r.sku);
    return {
      ...r,
      on_hand_stock: onHand,
      onHandStock: onHand,
      reserved_stock: reserved,
      reservedStock: reserved,
      stock: Math.max(0, onHand - reserved),
    };
  });
}

module.exports = {
  loadReservedHoldsForBranch,
  reservedQtyForProduct,
  applySoftReservesToRows,
};
