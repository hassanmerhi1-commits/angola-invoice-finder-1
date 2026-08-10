/**
 * Phase B1 — save-first local sale on shop client SQLite.
 * Synchronous better-sqlite3 API; no network required.
 */
const crypto = require('crypto');

const OUTBOX_DEST_CITY = 'CITY_SERVER';
const OUTBOX_DEST_AGT = 'AGT';

function nowIso() {
  return new Date().toISOString();
}

function requirePositive(n, label) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${label} inválido`);
  return v;
}

function allocateLocalInvoiceNumber(db, branchCode) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const code = String(branchCode || 'SHOP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'SHOP';
  const key = `inv_seq:${code}:${day}`;
  const row = db.prepare('SELECT value FROM client_meta WHERE key = ?').get(key);
  const seq = row ? Number(row.value) + 1 : 1;
  db.prepare(
    `INSERT INTO client_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(seq));
  return `LOCAL-${code}-${day}-${String(seq).padStart(4, '0')}`;
}

function signSaleLocally(db, sale) {
  const prev = db.prepare(
    `SELECT saft_hash FROM sales WHERE branch_id = ? AND saft_hash IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(sale.branch_id);
  const previousHash = prev?.saft_hash || '0';
  const canonical = [
    sale.created_at,
    nowIso(),
    sale.invoice_number,
    Number(sale.total || 0).toFixed(2),
    previousHash,
  ].join(';');
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return hash.substring(0, 4).toUpperCase();
}

function upsertProductCache(db, product) {
  if (!product?.id) return;
  db.prepare(
    `INSERT INTO products_cache (id, sku, name, price, cost, tax_rate, stock, branch_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sku = excluded.sku,
       name = excluded.name,
       price = excluded.price,
       cost = excluded.cost,
       tax_rate = excluded.tax_rate,
       stock = COALESCE(excluded.stock, products_cache.stock),
       branch_id = excluded.branch_id,
       updated_at = excluded.updated_at`
  ).run(
    product.id,
    product.sku || '',
    product.name || '',
    Number(product.price) || 0,
    Number(product.cost) || 0,
    Number(product.taxRate ?? product.tax_rate) || 0,
    Number(product.stock) || 0,
    product.branchId || product.branch_id || null,
    nowIso()
  );
}

function seedProductCacheFromItems(db, items, branchId) {
  for (const item of items || []) {
    const pid = item.productId || item.product_id;
    if (!pid) continue;
    const existing = db.prepare('SELECT stock FROM products_cache WHERE id = ?').get(pid);
    if (existing) continue;
    db.prepare(
      `INSERT INTO products_cache (id, sku, name, price, cost, tax_rate, stock, branch_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      pid,
      item.sku || '',
      item.productName || item.product_name || '',
      Number(item.unitPrice ?? item.unit_price) || 0,
      0,
      Number(item.taxRate ?? item.tax_rate) || 0,
      999999,
      branchId,
      nowIso()
    );
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} saleData
 */
function saveLocalSale(db, saleData) {
  const {
    branchId,
    cashierId,
    cashierName,
    items,
    subtotal,
    taxAmount,
    discount,
    total,
    paymentMethod,
    amountPaid,
    change,
    customerNif,
    customerName,
    clientId,
    clientRequestId,
    idempotencyKey,
    invoiceNumber: presetInvoice,
    branchCode,
  } = saleData;

  if (!branchId) throw new Error('branchId obrigatório');
  if (!cashierId) throw new Error('cashierId obrigatório');
  if (!items?.length) throw new Error('Venda deve ter pelo menos um item');

  const totalAmount = requirePositive(total, 'total');
  const method = String(paymentMethod || 'cash').trim().toLowerCase();
  const resolvedClientId = String(clientId || saleData.client_id || '').trim() || null;
  if (method === 'credit' && !resolvedClientId) {
    throw new Error('Venda a prazo exige cliente registado (clientId)');
  }
  const clientReq = clientRequestId || idempotencyKey || crypto.randomUUID();

  const dup = db.prepare(
    'SELECT id, invoice_number, total, status, created_at FROM sales WHERE client_request_id = ?'
  ).get(clientReq);
  if (dup) {
    return {
      duplicate: true,
      sale: {
        id: dup.id,
        invoice_number: dup.invoice_number,
        invoiceNumber: dup.invoice_number,
        total: dup.total,
        status: dup.status,
        created_at: dup.created_at,
        pendingSync: true,
        client_request_id: clientReq,
      },
    };
  }

  seedProductCacheFromItems(db, items, branchId);

  for (const item of items) {
    const pid = item.productId || item.product_id;
    if (!pid) continue;
    const cached = db.prepare('SELECT name, stock FROM products_cache WHERE id = ?').get(pid);
    const qty = Number(item.quantity) || 0;
    if (cached && cached.stock + 0.0001 < qty) {
      throw new Error(
        `Stock insuficiente (local) para ${cached.name || item.productName}. Disponível: ${cached.stock}, Solicitado: ${qty}`
      );
    }
  }

  const saleId = crypto.randomUUID();
  const createdAt = nowIso();
  const invoiceNumber = presetInvoice || allocateLocalInvoiceNumber(db, branchCode || branchId.slice(0, 8));

  const saveTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO sales (
        id, invoice_number, branch_id, cashier_id, cashier_name,
        subtotal, tax_amount, discount, total, payment_method, amount_paid, change_amount,
        customer_nif, customer_name, client_id, status, client_request_id, saft_hash, agt_status,
        pending_sync, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, NULL, 'pending', 1, ?)`
    ).run(
      saleId,
      invoiceNumber,
      branchId,
      cashierId,
      cashierName || '',
      Number(subtotal) || 0,
      Number(taxAmount) || 0,
      Number(discount) || 0,
      totalAmount,
      method || 'cash',
      Number(amountPaid) || totalAmount,
      Number(change) || 0,
      customerNif || '',
      customerName || '',
      resolvedClientId,
      clientReq,
      createdAt
    );

    const insertItem = db.prepare(
      `INSERT INTO sale_items (
        id, sale_id, product_id, product_name, sku, quantity,
        unit_price, discount, tax_rate, tax_amount, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const item of items) {
      const pid = item.productId || item.product_id;
      insertItem.run(
        crypto.randomUUID(),
        saleId,
        pid || null,
        item.productName || item.product_name || '',
        item.sku || '',
        Number(item.quantity) || 0,
        Number(item.unitPrice ?? item.unit_price) || 0,
        Number(item.discount) || 0,
        Number(item.taxRate ?? item.tax_rate) || 0,
        Number(item.taxAmount ?? item.tax_amount) || 0,
        Number(item.subtotal) || 0
      );
      if (pid) {
        const qty = Number(item.quantity) || 0;
        const stockRow = db.prepare('SELECT stock FROM products_cache WHERE id = ?').get(pid);
        const newStock = Math.max(0, (Number(stockRow?.stock) || 0) - qty);
        db.prepare('UPDATE products_cache SET stock = ?, updated_at = ? WHERE id = ?').run(newStock, nowIso(), pid);
      }
    }

    const saleRow = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    const shortHash = signSaleLocally(db, saleRow);
    db.prepare('UPDATE sales SET saft_hash = ? WHERE id = ?').run(shortHash, saleId);

    const saleItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
    const cityPayload = {
      saleData: {
        branchId,
        cashierId,
        cashierName,
        items: items.map((i) => ({
          productId: i.productId || i.product_id,
          productName: i.productName || i.product_name,
          sku: i.sku,
          quantity: i.quantity,
          unitPrice: i.unitPrice ?? i.unit_price,
          discount: i.discount,
          taxRate: i.taxRate ?? i.tax_rate,
          taxAmount: i.taxAmount ?? i.tax_amount,
          subtotal: i.subtotal,
        })),
        subtotal,
        taxAmount,
        discount: discount || 0,
        total: totalAmount,
        paymentMethod: method,
        amountPaid,
        change,
        customerNif,
        customerName,
        clientId: resolvedClientId || undefined,
        clientRequestId: clientReq,
        invoiceNumber,
        // Preserve the real sale time so city ingest does not stamp sync-time as sold-at
        // (offline queues can sit for hours/days before flush).
        createdAt,
        created_at: createdAt,
      },
    };

    const outboxId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO sync_outbox (
        id, event_type, entity_type, entity_id, payload_json, destination, status, created_at
      ) VALUES (?, 'sale.created', 'sale', ?, ?, ?, 'pending', ?)`
    ).run(outboxId, saleId, JSON.stringify(cityPayload), OUTBOX_DEST_CITY, nowIso());

    const agtId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO agt_submissions (
        id, sale_id, invoice_number, status, request_json, created_at
      ) VALUES (?, ?, ?, 'pending', ?, ?)`
    ).run(
      agtId,
      saleId,
      invoiceNumber,
      JSON.stringify({
        documentType: 'FT',
        invoiceNumber,
        total: totalAmount,
        hash: shortHash,
        customerNif: customerNif || '999999990',
      }),
      nowIso()
    );

    return { saleId, invoiceNumber, shortHash, saleItems };
  });

  let result;
  try {
    result = saveTx();
  } catch (err) {
    if (/UNIQUE constraint failed.*client_request_id/i.test(String(err?.message || err))) {
      const dupRetry = db.prepare(
        'SELECT id, invoice_number, total, status, created_at FROM sales WHERE client_request_id = ?'
      ).get(clientReq);
      if (dupRetry) {
        return {
          duplicate: true,
          sale: {
            id: dupRetry.id,
            invoice_number: dupRetry.invoice_number,
            invoiceNumber: dupRetry.invoice_number,
            total: dupRetry.total,
            status: dupRetry.status,
            created_at: dupRetry.created_at,
            pendingSync: true,
            client_request_id: clientReq,
          },
        };
      }
    }
    throw err;
  }

  return {
    duplicate: false,
    sale: {
      id: result.saleId,
      invoice_number: result.invoiceNumber,
      invoiceNumber: result.invoiceNumber,
      total: totalAmount,
      status: 'completed',
      saft_hash: result.shortHash,
      agt_status: 'pending',
      pendingSync: true,
      client_request_id: clientReq,
      created_at: createdAt,
    },
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} [branchId]
 */
function listLocalSales(db, branchId) {
  const branchKey = branchId != null ? String(branchId).trim() : '';
  const sales = branchKey
    ? db.prepare(
      'SELECT * FROM sales WHERE branch_id = ? ORDER BY created_at DESC LIMIT 500',
    ).all(branchKey)
    : db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 500').all();
  const itemsStmt = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?');
  return sales.map((sale) => ({
    ...sale,
    pendingSync: !!sale.pending_sync,
    pending_sync: !!sale.pending_sync,
    items: itemsStmt.all(sale.id),
  }));
}

module.exports = {
  saveLocalSale,
  listLocalSales,
  upsertProductCache,
  allocateLocalInvoiceNumber,
  OUTBOX_DEST_CITY,
  OUTBOX_DEST_AGT,
};
