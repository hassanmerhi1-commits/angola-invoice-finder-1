/**
 * Global search across clients, products, sales, and purchase invoices.
 */
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

function likeParam(q) {
  return `%${String(q).replace(/[%_]/g, '').slice(0, 80)}%`;
}

module.exports = function searchRouter() {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) {
        return res.json({ q, clients: [], products: [], sales: [], purchaseInvoices: [] });
      }
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 8));
      const pattern = likeParam(q);

      const [clients, products, sales, purchaseInvoices] = await Promise.all([
        db.query(
          `SELECT id, name, nif, phone
           FROM clients
           WHERE COALESCE(is_active, true) = true
             AND (name ILIKE $1 OR nif ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1)
           ORDER BY name ASC
           LIMIT $2`,
          [pattern, limit],
        ).catch(async () => db.query(
          `SELECT id, name, nif, phone
           FROM clients
           WHERE COALESCE(is_active, 1) = 1
             AND (LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(nif,'')) LIKE LOWER($1)
                  OR LOWER(IFNULL(phone,'')) LIKE LOWER($1) OR LOWER(IFNULL(email,'')) LIKE LOWER($1))
           ORDER BY name ASC
           LIMIT $2`,
          [pattern, limit],
        )),
        db.query(
          `SELECT id, name, sku, barcode, stock
           FROM products
           WHERE COALESCE(is_active, true) = true
             AND (name ILIKE $1 OR sku ILIKE $1 OR barcode ILIKE $1)
           ORDER BY name ASC
           LIMIT $2`,
          [pattern, limit],
        ).catch(async () => db.query(
          `SELECT id, name, sku, barcode, stock
           FROM products
           WHERE COALESCE(is_active, 1) = 1
             AND (LOWER(name) LIKE LOWER($1) OR LOWER(IFNULL(sku,'')) LIKE LOWER($1)
                  OR LOWER(IFNULL(barcode,'')) LIKE LOWER($1))
           ORDER BY name ASC
           LIMIT $2`,
          [pattern, limit],
        )),
        db.query(
          `SELECT id, invoice_number, customer_name, total, status, created_at
           FROM sales
           WHERE invoice_number ILIKE $1 OR customer_name ILIKE $1 OR customer_nif ILIKE $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [pattern, limit],
        ).catch(async () => db.query(
          `SELECT id, invoice_number, customer_name, total, status, created_at
           FROM sales
           WHERE LOWER(IFNULL(invoice_number,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(customer_name,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(customer_nif,'')) LIKE LOWER($1)
           ORDER BY created_at DESC
           LIMIT $2`,
          [pattern, limit],
        )),
        db.query(
          `SELECT id, invoice_number, supplier_name, total, status, date
           FROM purchase_invoices
           WHERE invoice_number ILIKE $1 OR supplier_name ILIKE $1
              OR supplier_invoice_no ILIKE $1
           ORDER BY date DESC NULLS LAST
           LIMIT $2`,
          [pattern, limit],
        ).catch(async () => db.query(
          `SELECT id, invoice_number, supplier_name, total, status, date
           FROM purchase_invoices
           WHERE LOWER(IFNULL(invoice_number,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(supplier_name,'')) LIKE LOWER($1)
              OR LOWER(IFNULL(supplier_invoice_no,'')) LIKE LOWER($1)
           ORDER BY date DESC
           LIMIT $2`,
          [pattern, limit],
        )),
      ]);

      res.json({
        q,
        clients: (clients.rows || []).map((r) => ({
          id: r.id,
          name: r.name,
          nif: r.nif,
          phone: r.phone,
          href: `/clients`,
        })),
        products: (products.rows || []).map((r) => ({
          id: r.id,
          name: r.name,
          sku: r.sku,
          barcode: r.barcode,
          stock: r.stock,
          href: `/inventory`,
        })),
        sales: (sales.rows || []).map((r) => ({
          id: r.id,
          invoiceNumber: r.invoice_number,
          customerName: r.customer_name,
          total: r.total,
          status: r.status,
          href: `/invoices`,
        })),
        purchaseInvoices: (purchaseInvoices.rows || []).map((r) => ({
          id: r.id,
          invoiceNumber: r.invoice_number,
          supplierName: r.supplier_name,
          total: r.total,
          status: r.status,
          href: `/purchase-invoices`,
        })),
      });
    } catch (e) {
      console.error('[SEARCH]', e);
      res.status(500).json({ error: e.message || 'Search failed' });
    }
  });

  return router;
};
