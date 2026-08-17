/**
 * Soft holds from reserved / partially shipped sales orders (reserved_qty > 0).
 * Stock ledger still uses branch id as warehouse_id.
 *
 * Proforma quotes are display-only (3 days after issue) and never reduce available stock.
 */

const { isPostgresEngine } = require('./sqlDialect');

const PROFORMA_QUOTE_DAYS = 3;

function emptyHolds() {
  return { byProductId: new Map(), bySku: new Map() };
}

function addHoldRow(holds, productId, sku, qty) {
  const n = Math.max(0, Number(qty) || 0);
  if (!n) return;
  const pid = String(productId || '').trim();
  const skuKey = String(sku || '').trim().toLowerCase();
  if (pid) holds.byProductId.set(pid, (holds.byProductId.get(pid) || 0) + n);
  if (skuKey) holds.bySku.set(skuKey, (holds.bySku.get(skuKey) || 0) + n);
}

function createdWithinDaysSql(days) {
  const n = Math.max(1, Number(days) || PROFORMA_QUOTE_DAYS);
  if (isPostgresEngine()) {
    return `p.created_at >= NOW() - INTERVAL '${n} days'`;
  }
  return `datetime(p.created_at) >= datetime('now', '-${n} days')`;
}

async function loadReservedHoldsForBranch(db, branchId) {
  const branch = String(branchId || '').trim();
  const holds = emptyHolds();
  if (!branch) return holds;

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
      addHoldRow(holds, row.product_id, row.sku, row.qty);
    }
  } catch (_) {
    // sales_orders missing on old DBs
  }
  return holds;
}

/**
 * Informational proforma quantities for the last 3 days.
 * Excludes converted / rejected / expired. Does not lock stock.
 */
async function loadProformaQuotesForBranch(db, branchId) {
  const branch = String(branchId || '').trim();
  const quotes = emptyHolds();
  if (!branch) return quotes;

  try {
    const r = await db.query(
      `SELECT
         CAST(i.product_id AS TEXT) AS product_id,
         LOWER(TRIM(COALESCE(i.sku, ''))) AS sku,
         COALESCE(SUM(i.quantity), 0) AS qty
       FROM proforma_items i
       INNER JOIN proformas p ON p.id = i.proforma_id
       WHERE CAST(p.branch_id AS TEXT) = CAST($1 AS TEXT)
         AND LOWER(TRIM(COALESCE(p.status, ''))) NOT IN ('converted', 'rejected', 'expired')
         AND TRIM(COALESCE(p.converted_to_invoice_id, '')) = ''
         AND ${createdWithinDaysSql(PROFORMA_QUOTE_DAYS)}
         AND COALESCE(i.quantity, 0) > 0
       GROUP BY CAST(i.product_id AS TEXT), LOWER(TRIM(COALESCE(i.sku, '')))`,
      [branch],
    );
    for (const row of r.rows || []) {
      addHoldRow(quotes, row.product_id, row.sku, row.qty);
    }
  } catch (_) {
    // proformas missing on old DBs
  }
  return quotes;
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

/** Mutate/map product-like rows: stock becomes available (onHand - sales-order reserved). */
function applySoftReservesToRows(rows, holds, quotes) {
  if (!Array.isArray(rows)) return rows || [];
  return rows.map((r) => {
    const onHand = Math.max(0, Number(r.stock) || 0);
    const locked = reservedQtyForProduct(holds, r.id || r.product_id, r.sku);
    const quoted = reservedQtyForProduct(quotes, r.id || r.product_id, r.sku);
    return {
      ...r,
      on_hand_stock: onHand,
      onHandStock: onHand,
      locked_stock: locked,
      lockedStock: locked,
      quoted_stock: quoted,
      quotedStock: quoted,
      reserved_stock: locked + quoted,
      reservedStock: locked + quoted,
      stock: Math.max(0, onHand - locked),
    };
  });
}

/** Apply sales-order locks + 3-day proforma quotes for one branch. */
async function applyBranchReserves(db, rows, branchId) {
  const [holds, quotes] = await Promise.all([
    loadReservedHoldsForBranch(db, branchId),
    loadProformaQuotesForBranch(db, branchId),
  ]);
  return applySoftReservesToRows(rows, holds, quotes);
}

module.exports = {
  PROFORMA_QUOTE_DAYS,
  loadReservedHoldsForBranch,
  loadProformaQuotesForBranch,
  reservedQtyForProduct,
  applySoftReservesToRows,
  applyBranchReserves,
};
