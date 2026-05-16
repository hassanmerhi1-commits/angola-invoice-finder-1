// Products API routes — with Optimistic Locking (Phase 3) + Multi-Price Levels
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { checkOptimisticLock } = require('../middleware/security');

function sanitizeUuid(value) {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : null;
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Get all products
  router.get('/', async (req, res) => {
    try {
      const { branchId } = req.query;
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
              WHEN bp.id IS NOT NULL THEN MAX(
                COALESCE(bp.stock, 0),
                COALESCE((
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
                    AND p.sku IS NOT NULL AND TRIM(p.sku) != ''
                    AND LOWER(TRIM(COALESCE(pm.sku, ''))) = LOWER(TRIM(p.sku))
                ), 0)
              )
              WHEN p.branch_id = $1 THEN MAX(
                COALESCE(p.stock, 0),
                COALESCE((
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
                    AND p.sku IS NOT NULL AND TRIM(p.sku) != ''
                    AND LOWER(TRIM(COALESCE(pm.sku, ''))) = LOWER(TRIM(p.sku))
                ), 0)
              )
              WHEN p.branch_id IS NULL AND COALESCE(
                (SELECT b.is_main FROM branches b WHERE b.id = $1 LIMIT 1),
                0
              ) = 1 THEN COALESCE(p.stock, 0)
              ELSE COALESCE((
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
                  AND p.sku IS NOT NULL AND TRIM(p.sku) != ''
                  AND LOWER(TRIM(COALESCE(pm.sku, ''))) = LOWER(TRIM(p.sku))
              ), 0)
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
          LEFT JOIN products bp ON COALESCE(bp.is_active, 1) != 0
            AND bp.branch_id = $1
            AND p.sku IS NOT NULL AND TRIM(p.sku) != ''
            AND bp.sku = p.sku
          WHERE COALESCE(p.is_active, 1) != 0
            AND (
              p.branch_id = $1
              OR (
                p.branch_id IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM products bx
                  WHERE COALESCE(bx.is_active, 1) != 0 AND bx.branch_id = $1
                    AND bx.sku = p.sku AND p.sku IS NOT NULL AND TRIM(p.sku) != ''
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
      console.log(`[PRODUCTS GET] branchId=${branchId || 'ALL'} rows=${result.rows.length}`);
      if (result.rows.length > 0) {
        console.log('[PRODUCTS GET] first_rows=', JSON.stringify(result.rows.slice(0, 5)));
      }
      res.json(result.rows);
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
      const resolvedBranchId = sanitizeUuid(branchId);
      // SQLite expands $10 four times from ONE param — do not pass c,c,c,c in the array.
      const result = await db.query(
        `INSERT INTO products (id, name, sku, barcode, category, price, price2, price3, price4, cost, first_cost, last_cost, avg_cost, stock, unit, tax_rate, branch_id, is_active, supplier_id, supplier_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          id, name, sku, barcode, category, price, price2 || 0, price3 || 0, price4 || 0,
          c,
          stock || 0, unit || 'un', taxRate || 14, resolvedBranchId, activeInt,
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
           sanitizeUuid(branchId), isActive !== false ? 1 : 0,
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
           sanitizeUuid(branchId), isActive !== false ? 1 : 0,
           price2 || 0, price3 || 0, price4 || 0,
           sanitizeUuid(supplierId), supplierName || null,
           lastCost ?? null, avgCost ?? null,
           id]
        );
        if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Product not found' });
        }
      }
      
      await broadcastTable('products');
      res.json(result.rows[0]);
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

  // Batch import products
  router.post('/batch', async (req, res) => {
    try {
      if (!db.sqlite) {
        return res.status(501).json({
          error:
            'Product batch import is implemented for SQLite only. Use POST /api/products for single items, or run the app in SQLite mode for bulk import.',
        });
      }
      const { products } = req.body;
      if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'products array is required' });
      }

      const sqlite = db.sqlite;
      console.log('IMPORT DB:', db.dbPath);

      // 5) Check schema before importing.
      const tableInfo = sqlite.prepare('PRAGMA table_info(products)').all();
      const schemaColumns = tableInfo.map((c) => c.name);
      console.log('[PRODUCTS IMPORT] schema columns:', schemaColumns.join(','));

      const requiredWithoutDefault = tableInfo
        .filter((c) => Number(c.notnull) === 1 && c.dflt_value == null)
        .map((c) => c.name);
      console.log('[PRODUCTS IMPORT] required columns (no default):', requiredWithoutDefault.join(',') || '(none)');

      // 7) Force test insert/select (then cleanup).
      try {
        const force = sqlite.prepare('INSERT INTO products (name) VALUES (?)').run('TEST123');
        const forcedRow = sqlite
          .prepare('SELECT rowid, name FROM products WHERE name = ? ORDER BY rowid DESC LIMIT 1')
          .get('TEST123');
        console.log('[PRODUCTS IMPORT] FORCE TEST:', {
          inserted: force.changes,
          rowid: force.lastInsertRowid,
          found: !!forcedRow,
        });
        if (force.changes > 0) {
          sqlite.prepare('DELETE FROM products WHERE rowid = ?').run(force.lastInsertRowid);
        }
      } catch (e) {
        console.error('[PRODUCTS IMPORT] FORCE TEST ERROR:', e.message);
      }

      let inserted = 0;
      let updated = 0;
      let failed = 0;
      const errors = [];

      const colSet = new Set(schemaColumns);
      const updatableColumns = schemaColumns.filter((c) => !['id', 'created_at'].includes(c));

      const updateSql = updatableColumns.length
        ? `UPDATE products SET ${updatableColumns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
        : null;
      const updateStmt = updateSql ? sqlite.prepare(updateSql) : null;

      for (const p of products) {
        const rawSku = String(p?.sku ?? p?.codigo ?? p?.code ?? p?.id ?? '').trim();
        const rawName = String(p?.name ?? p?.descricao ?? p?.description ?? p?.designacao ?? '').trim();
        const sku = rawSku || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const name = rawName || sku;
        const branchId = sanitizeUuid(p.branchId);

        // 4) Ensure required fields are supplied.
        const rowData = {
          id: crypto.randomUUID(),
          name,
          sku,
          barcode: p.barcode || '',
          category: p.category || 'GERAL',
          price: Number(p.price) || 0,
          price2: Number(p.price2) || 0,
          price3: Number(p.price3) || 0,
          price4: Number(p.price4) || 0,
          cost: Number(p.cost) || 0,
          first_cost: Number(p.cost) || 0,
          last_cost: Number(p.cost) || 0,
          avg_cost: Number(p.cost) || 0,
          stock: Number(p.stock ?? p.quantidade) || 0,
          unit: String(p.unit || p.unidade || 'UN'),
          tax_rate: Number(p.taxRate ?? p.iva) || 14,
          branch_id: branchId,
          supplier_id: sanitizeUuid(p.supplierId),
          supplier_name: p.supplierName || null,
          is_active: p.isActive !== false ? 1 : 0,
          updated_at: new Date().toISOString(),
        };

        try {
          let updatedExisting = false;
          if (colSet.has('sku') && updateStmt) {
            const existing = sqlite
              .prepare('SELECT id FROM products WHERE sku = ? LIMIT 1')
              .get(sku);
            if (existing?.id) {
              const updateValues = updatableColumns.map((c) => rowData[c]);
              const updateRes = updateStmt.run(...updateValues, existing.id);
              if (updateRes.changes > 0) {
                updated++;
                updatedExisting = true;
              }
            }
          }

          if (!updatedExisting) {
            const insertCols = schemaColumns.filter((c) => Object.prototype.hasOwnProperty.call(rowData, c));
            const missingRequired = requiredWithoutDefault.filter((c) => !insertCols.includes(c));
            if (missingRequired.length > 0) {
              throw new Error(`Missing required columns: ${missingRequired.join(', ')}`);
            }

            const placeholders = insertCols.map(() => '?').join(', ');
            const insertSql = `INSERT INTO products (${insertCols.join(', ')}) VALUES (${placeholders})`;
            const insertValues = insertCols.map((c) => rowData[c]);

            // 2) Insert with run() and verify changes.
            const insertRes = sqlite.prepare(insertSql).run(...insertValues);
            if (insertRes.changes > 0) {
              inserted++;
            } else {
              throw new Error('Insert returned changes=0');
            }
          }
        } catch (err) {
          failed++;
          const rowError = err?.message || String(err);
          console.error('[PRODUCTS IMPORT ROW ERROR]', rowError, { sku });
          errors.push({ sku, error: rowError });
        }
      }

      // 3) Count after import.
      const totalRow = sqlite.prepare('SELECT COUNT(*) AS total FROM products').get();
      console.log(
        `[PRODUCTS IMPORT DEBUG] inserted=${inserted} updated=${updated} failed=${failed} products_total=${Number(totalRow?.total || 0)}`
      );

      await broadcastTable('products');
      // 6) Report "imported" only from real INSERT operations.
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
