/**
 * Copy a city credit note or debit note onto the main server.
 * The row is a copy of the document. Stock, cash, and journals already travel
 * on their own events, so this path must not post them again.
 */

async function findExistingNote(query, table, id, documentNumber) {
  const dup = await query(
    `SELECT id FROM ${table} WHERE id = $1 OR document_number = $2 LIMIT 1`,
    [id, documentNumber || ''],
  );
  return dup.rows[0] || null;
}

async function mirrorCreditNoteEvent(query, payload) {
  const note = payload?.credit_note;
  if (!note?.id) return { skipped: true, reason: 'no credit note' };

  const existing = await findExistingNote(query, 'credit_notes', note.id, note.document_number);
  if (existing && existing.id !== note.id) {
    return { skipped: true, reason: 'duplicate', id: existing.id };
  }

  if (!existing) {
    await query(
      `INSERT INTO credit_notes (
        id, document_number, branch_id, branch_name,
        original_invoice_id, original_invoice_number,
        reason, reason_description,
        subtotal, tax_amount, total,
        customer_nif, customer_name,
        status, restore_stock, saft_hash, agt_status, agt_code,
        issued_by, issued_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        note.id,
        note.document_number,
        note.branch_id || null,
        note.branch_name || '',
        note.original_invoice_id || null,
        note.original_invoice_number || null,
        note.reason,
        note.reason_description || '',
        note.subtotal,
        note.tax_amount,
        note.total,
        note.customer_nif || null,
        note.customer_name || null,
        note.status || 'issued',
        note.restore_stock !== false && note.restore_stock !== 0,
        note.saft_hash || null,
        note.agt_status || null,
        note.agt_code || null,
        note.issued_by || null,
        note.issued_at || note.created_at || new Date().toISOString(),
        note.created_at || new Date().toISOString(),
      ],
    );
  }

  for (const item of payload.items || []) {
    const itemId = item.id;
    if (!itemId) continue;
    const line = await query(`SELECT 1 FROM credit_note_items WHERE id = $1`, [itemId]);
    if (line.rows.length) continue;
    await query(
      `INSERT INTO credit_note_items (
        id, credit_note_id, product_id, product_name, sku,
        quantity, unit_price, tax_rate, tax_amount, subtotal
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        itemId,
        note.id,
        item.product_id || null,
        item.product_name || '',
        item.sku || '',
        item.quantity,
        item.unit_price,
        item.tax_rate || 0,
        item.tax_amount || 0,
        item.subtotal || 0,
      ],
    );
  }

  return { mirrored: true, id: note.id, duplicate: Boolean(existing) };
}

async function mirrorDebitNoteEvent(query, payload) {
  const note = payload?.debit_note;
  if (!note?.id) return { skipped: true, reason: 'no debit note' };

  const existing = await findExistingNote(query, 'debit_notes', note.id, note.document_number);
  if (existing && existing.id !== note.id) {
    return { skipped: true, reason: 'duplicate', id: existing.id };
  }

  if (!existing) {
    await query(
      `INSERT INTO debit_notes (
        id, document_number, branch_id, branch_name,
        original_invoice_id, original_invoice_number,
        reason, reason_description,
        subtotal, tax_amount, total,
        customer_nif, customer_name,
        status, saft_hash, agt_status, agt_code,
        issued_by, issued_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        note.id,
        note.document_number,
        note.branch_id || null,
        note.branch_name || '',
        note.original_invoice_id || null,
        note.original_invoice_number || null,
        note.reason,
        note.reason_description || '',
        note.subtotal,
        note.tax_amount,
        note.total,
        note.customer_nif || null,
        note.customer_name || null,
        note.status || 'issued',
        note.saft_hash || null,
        note.agt_status || null,
        note.agt_code || null,
        note.issued_by || null,
        note.issued_at || note.created_at || new Date().toISOString(),
        note.created_at || new Date().toISOString(),
      ],
    );
  }

  for (const item of payload.items || []) {
    const itemId = item.id;
    if (!itemId) continue;
    const line = await query(`SELECT 1 FROM debit_note_items WHERE id = $1`, [itemId]);
    if (line.rows.length) continue;
    await query(
      `INSERT INTO debit_note_items (
        id, debit_note_id, description, quantity, unit_price, tax_rate, tax_amount, subtotal
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        itemId,
        note.id,
        item.description || '',
        item.quantity ?? 1,
        item.unit_price,
        item.tax_rate || 0,
        item.tax_amount || 0,
        item.subtotal || 0,
      ],
    );
  }

  return { mirrored: true, id: note.id, duplicate: Boolean(existing) };
}

module.exports = {
  mirrorCreditNoteEvent,
  mirrorDebitNoteEvent,
};
