// Products API routes — with Optimistic Locking (Phase 3) + Multi-Price Levels
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { DEFAULT_VAT_RATE } = require('../taxDefaults');
const { checkOptimisticLock } = require('../middleware/security');
const { attachUserBranchScope, resolveListBranchId } = require('../middleware/branchScope');

function sanitizeUuid(value) {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : null;
}

/** Preserve text branch ids (e.g. branch-main) on SQLite; UUID on Postgres when valid. */
function resolveProductBranchId(req, requestedBranchId) {
  const scoped = resolveListBranchId(req, requestedBranchId);
  if (scoped === undefined) return undefined;
  if (!scoped) return null;
  const key = String(scoped).trim();
  if (db.engine === 'sqlite') return key;
  return sanitizeUuid(key) || key;
}

function normalizeSkuKey(sku) {
  return String(sku || '').trim().toLowerCase();
}

/** One row per SKU when duplicate branch/catalog rows exist (e.g. after repeated transfers). */
function dedupeProductsBySku(rows, branchId) {
  const bySku = new Map();
  for (const row of rows) {
    const key = normalizeSkuKey(row.sku) || row.id;
    const prev = bySku.get(key);
    if (!prev) {
      bySku.set(key, row);
      continue;
    }
    const score = (r) => {
      let s = Number(r.stock || 0);
      if (branchId && String(r.branch_id || '') === String(branchId)) s += 1_000_000;
      return s;
    };
    bySku.set(key, score(row) >= score(prev) ? row : prev);
  }
  return Array.from(bySku.values());
}

module.exports = function(broadcastTable) {
  const router = express.Router();
  router.use(attachUserBranchScope);

  // Get all products
  router.get('/', async (req, res) => {
    try {
      const branchId = resolveListBranchId(req, req.query.branchId);
      if (branchId === undefined) {
        return res.json([]);
      }
      const params = [];
      let query;

      if (branchId) {
        const branchKey = String(branchId).trim();
        // One row per catalog SKU; stock from branch row + movements at this warehouse (by SKU).
        query = `
          SELECT
            COALESCE(bp.id, p.id) AS id,
            COALESCE(bp.name, p.name) AS name,
            COALESCE(bp.sku, p.sku) AS sku,
            COALESCE(bp.barcode, p.barcode) AS barcode,
            COALESCE(bp.category, p.category) AS category,
            COALESCE(bp.price, p.price) AS price,
            COALESCE(bp.price2, p.price2) AS price2,
            COALESCE(bp.price3, p.price3) AS price3,
            COALESCE(bp.price4, p.price4) AS price4,
            COALESCE(bp.cost, p.cost) AS cost,
            COALESCE(bp.first_cost, p.first_cost, bp.cost, p.cost) AS first_cost,
            COALESCE(bp.last_cost, p.last_cost, bp.cost, p.cost) AS last_cost,
            COALESCE(bp.avg_cost, p.avg_cost, bp.cost, p.cost) AS avg_cost,
            CASE
              WHEN p.sku IS NOT NULL AND TRIM(p.sku) != '' AND EXISTS (
                SELECT 1
                FROM stock_movements sm
                INNER JOIN products pm ON pm.id = sm.product_id
                WHERE sm.warehouse_id = $1
                  AND LOWER(TRIM(COALESCE(pm.sku, ''))) = LOWER(TRIM(p.sku))
              ) THEN MAX(0, COALESCE((
                SELECT SUM(
                  CASE
                    WHEN sm.movement_type = 'IN' THEN sm.quantity
                    WHEN sm.movement_type = 'OUT' THEN -sm.quantity
                    ELSE 0
                  END
                )
                FROM stock_movements sm
                INNER JOIN products pm ON pm.id = sm.product_id
                WHERE sm.warehouse_id = $1
                  AND LOWER(TRIM(COALESCE(pm.sku, ''))) = LOWER(TRIM(p.sku))
              ), 0))
              WHEN bp.id IS NOT NULL THEN COALESCE(bp.stock, 0)
              WHEN p.branch_id = $1 THEN COALESCE(p.stock, 0)
              ELSE 0
            END AS stock,
            COALESCE(bp.unit, p.unit) AS unit,
            COALESCE(bp.tax_rate, p.tax_rate) AS tax_rate,
            COALESCE(bp.branch_id, $1) AS branch_id,
            COALESCE(bp.supplier_id, p.supplier_id) AS supplier_id,
            COALESCE(bp.supplier_name, p.supplier_name) AS supplier_name,
            COALESCE(bp.is_active, p.is_active) AS is_active,
            COALESCE(bp.created_at, p.created_at) AS created_at,
            COALESCE(bp.updated_at, p.updated_at) AS updated_at
          FROM products p
          LEFT JOIN products bp ON bp.id = (
            SELECT bx.id
            FROM products bx
            WHERE COALESCE(bx.is_active, 1) != 0
              AND bx.branch_id = $1
              AND p.sku IS NOT NULL AND TRIM(p.sku) != ''
              AND LOWER(TRIM(COALESCE(bx.sku, ''))) = LOWER(TRIM(p.sku))
            ORDER BY bx.updated_at DESC, bx.created_at DESC
            LIMIT 1
          )
          WHERE COALESCE(p.is_active, 1) != 0
            AND (
              p.branch_id = $1
              OR bp.id IS NOT NULL
              OR (
                (p.branch_id IS NULL OR TRIM(COALESCE(p.branch_id, '')) = '')
                AND NOT EXISTS (
                  SELECT 1 FROM products bx
                  WHERE COALESCE(bx.is_active, 1) != 0 AND bx.branch_id = $1
                    AND p.sku IS NOT NULL AND TRIM(p.sku) != ''
                    AND LOWER(TRIM(COALESCE(bx.sku, ''))) = LOWER(TRIM(p.sku))
                )
              )
              OR (
                p.branch_id IN (
                  SELECT id FROM branches
                  WHERE COALESCE(is_main, 0) != 0 AND COALESCE(is_active, 1) != 0
                )
                AND p.sku IS NOT NULL AND TRIM(p.sku) != ''
                AND NOT EXISTS (
                  SELECT 1 FROM products bx
                  WHERE COALESCE(bx.is_active, 1) != 0 AND bx.branch_id = $1
                    AND LOWER(TRIM(COALESCE(bx.sku, ''))) = LOWER(TRIM(p.sku))
                )
              )
            )
          ORDER BY name`;
        params.push(branchKey);
      } else {
        query = `
          SELECT p.*,
            COALESCE(p.first_cost, p.cost) AS first_cost,
            COALESCE(p.last_cost, p.cost) AS last_cost,
            COALESCE(p.avg_cost, p.cost) AS avg_cost,
            p.stock AS stock
          FROM products p
          WHERE COALESCE(p.is_active, 1) != 0
          ORDER BY p.name`;
      }

      const result = await db.query(query, params);
      const rows = dedupeProductsBySku(
        result.rows,
        branchId ? String(branchId).trim() : undefined,
      );
      console.log(`[PRODUCTS GET] branchId=${branchId || 'ALL'} rows=${rows.length}`);
      if (rows.length > 0) {
        console.log('[PRODUCTS GET] first_rows=', JSON.stringify(rows.slice(0, 5)));
      }
      res.json(rows);
    } catch (error) {
      console.error('[PRODUCTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });

  // Create product
  router.post('/', async (req, res) => {
    try {
      const { name, sku, barcode, category, price, price2, price3, price4, cost, stock, unit, taxRate, branchId, isActive, supplierId, supplierName } = req.body;
      const id = crypto.randomUUID();
      const activeInt = isActive !== false ? 1 : 0;

      const c = Number(cost) || 0;
      const resolvedBranchId = resolveProductBranchId(req, branchId);
      if (resolvedBranchId === undefined) {
        return res.status(403).json({ error: 'Sem filial atribuída para criar produtos.' });
      }
      // SQLite expands $10 four times from ONE param — do not pass c,c,c,c in the array.
      const result = await db.query(
        `INSERT INTO products (id, name, sku, barcode, category, price, price2, price3, price4, cost, first_cost, last_cost, avg_cost, stock, unit, tax_rate, branch_id, is_active, supplier_id, supplier_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          id, name, sku, barcode, category, price, price2 || 0, price3 || 0, price4 || 0,
          c,
          stock || 0, unit || 'un', taxRate ?? DEFAULT_VAT_RATE, resolvedBranchId, activeInt,
          sanitizeUuid(supplierId), supplierName || null,
        ]
      );
      
      await broadcastTable('products');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('[PRODUCTS ERROR]', error);
      const msg = String(error?.message || '');
      if (/unique|duplicate|UNIQUE constraint/i.test(msg)) {
        return res.status(409).json({
          error: 'Já existe um produto com este código (SKU) nesta filial ou catálogo partilhado.',
        });
      }
      res.status(500).json({ error: 'Failed to create product' });
    }
  });

  // Update product (with optimistic locking)
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, sku, barcode, category, price, price2, price3, price4, cost, stock, unit, taxRate, branchId, isActive, version, supplierId, supplierName, lastCost, avgCost } = req.body;
      
      let result;
      if (version != null) {
        result = await db.query(
          `UPDATE products 
           SET name=$1, sku=$2, barcode=$3, category=$4, price=$5, cost=$6, 
               stock=$7, unit=$8, tax_rate=$9, branch_id=$10, is_active=$11,
               price2=$12, price3=$13, price4=$14,
               supplier_id=$15, supplier_name=$16,
               last_cost=COALESCE($17, last_cost), avg_cost=COALESCE($18, avg_cost),
               version = version + 1
           WHERE id=$19 AND version=$20
           RETURNING *`,
          [name, sku, barcode, category, price, cost, stock, unit, taxRate,
           resolveProductBranchId(req, branchId) ?? sanitizeUuid(branchId),
           isActive !== false ? 1 : 0,
           price2 || 0, price3 || 0, price4 || 0,
           sanitizeUuid(supplierId), supplierName || null,
           lastCost ?? null, avgCost ?? null,
           id, version]
        );
        if (!checkOptimisticLock(result, res, 'Product')) return;
      } else {
        result = await db.query(
          `UPDATE products 
           SET name=$1, sku=$2, barcode=$3, category=$4, price=$5, cost=$6, 
               stock=$7, unit=$8, tax_rate=$9, branch_id=$10, is_active=$11,
               price2=$12, price3=$13, price4=$14,
               supplier_id=$15, supplier_name=$16,
               last_cost=COALESCE($17, last_cost), avg_cost=COALESCE($18, avg_cost)
           WHERE id=$19
           RETURNING *`,
          [name, sku, barcode, category, price, cost, stock, unit, taxRate,
           resolveProductBranchId(req, branchId) ?? sanitizeUuid(branchId),
           isActive !== false ? 1 : 0,
           price2 || 0, price3 || 0, price4 || 0,
           sanitizeUuid(supplierId), supplierName || null,
           lastCost ?? null, avgCost ?? null,
           id]
        );
        if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Product not found' });
        }
      }
      
      const updated = result.rows[0];
      const skuKey = String(updated?.sku || '').trim();
      if (skuKey && taxRate != null && taxRate !== '') {
        await db.query(
          `UPDATE products
           SET tax_rate = $1, updated_at = CURRENT_TIMESTAMP
           WHERE COALESCE(is_active, 1) != 0
             AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($2)`,
          [Number(taxRate), skuKey]
        );
      }

      await broadcastTable('products');
      res.json(updated);
    } catch (error) {
      console.error('[PRODUCTS ERROR]', error);
      res.status(500).json({ error: 'Failed to update product' });
    }
  });

  // Update stock
  router.patch('/:id/stock', async (req, res) => {
    try {
      const { id } = req.params;
      const { quantityChange } = req.body;
      
      const result = await db.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING *',
        [quantityChange, id]
      );
      
      await broadcastTable('products');
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[PRODUCTS ERROR]', error);
      res.status(500).json({ error: 'Failed to update stock' });
    }
  });

  // Batch import products (SQLite + PostgreSQL)
  router.post('/batch', async (req, res) => {
    try {
      const { products: productList } = req.body;
      if (!Array.isArray(productList) || productList.length === 0) {
        return res.status(400).json({ error: 'products array is required' });
      }

      let inserted = 0;
      let updated = 0;
      let failed = 0;
      const errors = [];

      for (const p of productList) {
        const rawSku = String(p?.sku ?? p?.codigo ?? p?.code ?? '').trim();
        const rawName = String(p?.name ?? p?.descricao ?? p?.description ?? p?.designacao ?? '').trim();
        const sku = rawSku || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const name = rawName || sku;
        const branchId = resolveProductBranchId(req, p.branchId);
        if (branchId === undefined) {
          failed += 1;
          errors.push({ sku, error: 'Sem filial atribuída' });
          continue;
        }
        const cost = Number(p.cost) || 0;
        const stock = Number(p.stock ?? p.quantidade) || 0;
        const activeInt = p.isActive !== false ? 1 : 0;

        try {
          const existing = await db.query(
            `SELECT id FROM products
             WHERE COALESCE(is_active, 1) != 0
               AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
             LIMIT 1`,
            [sku],
          );

          if (existing.rows[0]?.id) {
            const upd = await db.query(
              `UPDATE products
               SET name = $1, barcode = $2, category = $3, price = $4, cost = $5,
                   stock = $6, unit = $7, tax_rate = $8, branch_id = $9,
                   supplier_id = $10, supplier_name = $11, is_active = $12,
                   last_cost = COALESCE($5, last_cost), avg_cost = COALESCE($5, avg_cost),
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $13`,
              [
                name,
                p.barcode || '',
                p.category || 'GERAL',
                Number(p.price) || 0,
                cost,
                stock,
                String(p.unit || p.unidade || 'UN'),
                Number(p.taxRate ?? p.iva) || DEFAULT_VAT_RATE,
                branchId,
                sanitizeUuid(p.supplierId),
                p.supplierName || null,
                activeInt,
                existing.rows[0].id,
              ],
            );
            if (upd.rowCount > 0) updated++;
          } else {
            const id = crypto.randomUUID();
            const ins = await db.query(
              `INSERT INTO products (id, name, sku, barcode, category, price, price2, price3, price4, cost, first_cost, last_cost, avg_cost, stock, unit, tax_rate, branch_id, is_active, supplier_id, supplier_name)
               VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, $7, $7, $7, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [
                id,
                name,
                sku,
                p.barcode || '',
                p.category || 'GERAL',
                Number(p.price) || 0,
                cost,
                stock,
                String(p.unit || p.unidade || 'UN'),
                Number(p.taxRate ?? p.iva) || DEFAULT_VAT_RATE,
                branchId,
                activeInt,
                sanitizeUuid(p.supplierId),
                p.supplierName || null,
              ],
            );
            if (ins.rowCount > 0) inserted++;
          }
        } catch (err) {
          failed++;
          const rowError = err?.message || String(err);
          console.error('[PRODUCTS IMPORT ROW ERROR]', rowError, { sku });
          errors.push({ sku, error: rowError });
        }
      }

      console.log(`[PRODUCTS IMPORT] inserted=${inserted} updated=${updated} failed=${failed}`);
      await broadcastTable('products');
      res.status(201).json({ imported: inserted, updated, failed, errors: errors.slice(0, 50) });
    } catch (error) {
      console.error('[PRODUCTS BATCH ERROR]', error);
      res.status(500).json({ error: 'Failed to batch import products' });
    }
  });

  // Delete product (soft delete)
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      await db.query('UPDATE products SET is_active = false WHERE id = $1', [id]);
      
      await broadcastTable('products');
      res.json({ success: true });
    } catch (error) {
      console.error('[PRODUCTS ERROR]', error);
      res.status(500).json({ error: 'Failed to delete product' });
    }
  });

  return router;
};
