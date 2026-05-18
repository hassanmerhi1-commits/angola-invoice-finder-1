-- Migration 015: Unique business numbers (PostgreSQL)

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoice_number
  ON sales(invoice_number) WHERE invoice_number IS NOT NULL AND invoice_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_po_order_number
  ON purchase_orders(order_number) WHERE order_number IS NOT NULL AND order_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entry_number
  ON journal_entries(entry_number) WHERE entry_number IS NOT NULL AND entry_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_transfer_number
  ON stock_transfers(transfer_number) WHERE transfer_number IS NOT NULL AND transfer_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_returns_return_number
  ON supplier_returns(return_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_open_items_document_id
  ON open_items(document_id);
