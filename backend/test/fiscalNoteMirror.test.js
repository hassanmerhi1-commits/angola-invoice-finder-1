const test = require('node:test');
const assert = require('node:assert/strict');
const { mirrorCreditNoteEvent, mirrorDebitNoteEvent } = require('../src/sync/fiscalNoteMirror');

function memoryQuery(tables) {
  return async function query(sql, params) {
    const text = String(sql);
    if (text.includes('FROM credit_notes') || text.includes('FROM debit_notes')) {
      const table = text.includes('credit_notes') ? tables.creditNotes : tables.debitNotes;
      const found = [...table.values()].find(
        (row) => row.id === params[0] || row.document_number === params[1],
      );
      return { rows: found ? [found] : [] };
    }
    if (text.includes('FROM credit_note_items') || text.includes('FROM debit_note_items')) {
      const table = text.includes('credit_note_items') ? tables.creditItems : tables.debitItems;
      return { rows: table.has(params[0]) ? [{}] : [] };
    }
    if (text.startsWith('INSERT INTO credit_notes')) {
      tables.creditNotes.set(params[0], {
        id: params[0],
        document_number: params[1],
        saft_hash: params[15],
      });
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO debit_notes')) {
      tables.debitNotes.set(params[0], {
        id: params[0],
        document_number: params[1],
        saft_hash: params[14],
      });
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO credit_note_items')) {
      tables.creditItems.set(params[0], { id: params[0], credit_note_id: params[1] });
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO debit_note_items')) {
      tables.debitItems.set(params[0], { id: params[0], debit_note_id: params[1] });
      return { rows: [] };
    }
    throw new Error(`unexpected sql: ${text}`);
  };
}

function emptyTables() {
  return {
    creditNotes: new Map(),
    debitNotes: new Map(),
    creditItems: new Map(),
    debitItems: new Map(),
  };
}

test('credit note copy lands once, with its lines and hash', async () => {
  const tables = emptyTables();
  const query = memoryQuery(tables);
  const payload = {
    credit_note: {
      id: 'cn-1',
      document_number: 'NC-BENGUELA-2026-00001',
      reason: 'return',
      subtotal: 100,
      tax_amount: 14,
      total: 114,
      saft_hash: 'ab12',
      status: 'issued',
    },
    items: [{ id: 'line-1', product_name: 'Rice', quantity: 2, unit_price: 50, subtotal: 100 }],
  };

  const first = await mirrorCreditNoteEvent(query, payload);
  const second = await mirrorCreditNoteEvent(query, payload);

  assert.equal(first.mirrored, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(tables.creditNotes.size, 1);
  assert.equal(tables.creditNotes.get('cn-1').saft_hash, 'ab12');
  assert.equal(tables.creditItems.size, 1);
});

test('debit note copy lands once, with its lines', async () => {
  const tables = emptyTables();
  const query = memoryQuery(tables);
  const payload = {
    debit_note: {
      id: 'dn-1',
      document_number: 'ND-BENGUELA-2026-00001',
      reason: 'interest',
      subtotal: 10,
      tax_amount: 0,
      total: 10,
      status: 'issued',
    },
    items: [{ id: 'dline-1', description: 'Interest', quantity: 1, unit_price: 10, subtotal: 10 }],
  };

  await mirrorDebitNoteEvent(query, payload);
  await mirrorDebitNoteEvent(query, payload);

  assert.equal(tables.debitNotes.size, 1);
  assert.equal(tables.debitItems.size, 1);
});

test('a note number already used by another row is left alone', async () => {
  const tables = emptyTables();
  tables.creditNotes.set('other', { id: 'other', document_number: 'NC-SAME' });
  const query = memoryQuery(tables);
  const result = await mirrorCreditNoteEvent(query, {
    credit_note: { id: 'cn-2', document_number: 'NC-SAME', reason: 'error', subtotal: 1, tax_amount: 0, total: 1 },
    items: [{ id: 'line-x', product_name: 'X', quantity: 1, unit_price: 1, subtotal: 1 }],
  });
  assert.equal(result.skipped, true);
  assert.equal(tables.creditNotes.size, 1);
  assert.equal(tables.creditItems.size, 0);
});
