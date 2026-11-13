/**
 * A stock movement that is not part of a sale, purchase, or transfer
 * writes its journal in the same transaction. No cost means no journal,
 * so the movement is refused.
 */
const { createJournalEntry } = require('../accounting');
const {
  standaloneStockNeedsJournal,
  buildStockAdjustmentJournalLines,
  roundMoney,
} = require('./postingContract');

async function postStandaloneStockJournal(client, movement, body) {
  const referenceType = body.referenceType || body.reference_type || '';
  if (!standaloneStockNeedsJournal(referenceType)) return null;

  let unitCost = Number(body.unitCost ?? body.unit_cost);
  if (!(unitCost > 0) && movement.product_id) {
    const row = await client.query(
      'SELECT COALESCE(avg_cost, cost, 0) AS cost FROM products WHERE id = $1',
      [movement.product_id],
    );
    unitCost = Number(row.rows[0]?.cost) || 0;
  }

  const amount = roundMoney(Number(movement.quantity) * unitCost);
  const label = String(body.referenceNumber || body.reference_number || movement.id || '').trim() || movement.id;
  const lines = buildStockAdjustmentJournalLines(
    movement.movement_type,
    referenceType || 'correction',
    amount,
    label,
  );
  if (!lines.length) {
    throw new Error('Movimento de stock sem custo. Defina o custo do produto para lançar o diário.');
  }

  return createJournalEntry(client, {
    description: `Movimento de stock ${label}`,
    referenceType: 'stock_movement',
    referenceId: movement.id,
    branchId: body.branchId || body.branch_id || body.warehouseId || body.warehouse_id || null,
    createdBy: body.createdBy || body.created_by || null,
    entryDate: body.entryDate || body.entry_date || undefined,
    lines,
  });
}

module.exports = { postStandaloneStockJournal };
