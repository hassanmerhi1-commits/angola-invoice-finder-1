-- Optional warehouse metadata on stock transfers (ledger still uses branch id as warehouse_id).

ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS from_warehouse_id VARCHAR(64) DEFAULT '';
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS to_warehouse_id VARCHAR(64) DEFAULT '';
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS from_warehouse_name VARCHAR(255) DEFAULT '';
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS to_warehouse_name VARCHAR(255) DEFAULT '';
