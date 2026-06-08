"""One-off: merge -DUP- movements at Soyo onto canonical SKU (same as filialStockRepair)."""
import re
import sqlite3

db = r"C:\NEXOR ERP\data\erp.db"
soyo = "6817b070682200927fa9e8e5fae7295c"
conn = sqlite3.connect(db)
c = conn.cursor()

c.execute(
    """SELECT p.id, p.sku FROM products p
       WHERE p.sku LIKE '%-DUP-%'
         AND id IN (SELECT DISTINCT product_id FROM stock_movements WHERE warehouse_id=?)""",
    (soyo,),
)
dup_rows = c.fetchall()
merged = 0
for dup_id, sku in dup_rows:
    base = re.sub(r"-DUP-[a-f0-9]+$", "", sku, flags=re.I).strip()
    if not base:
        continue
    c.execute(
        """SELECT id FROM products
           WHERE id != ? AND COALESCE(is_active, 1) != 0
             AND LOWER(TRIM(sku)) = LOWER(?)
           ORDER BY CASE WHEN branch_id = ? THEN 0
                         WHEN branch_id IS NULL OR TRIM(COALESCE(branch_id,'')) = '' THEN 1
                         ELSE 2 END
           LIMIT 1""",
        (dup_id, base, soyo),
    )
    row = c.fetchone()
    if not row:
        print("no canonical for", sku)
        continue
    target = row[0]
    c.execute(
        "UPDATE stock_movements SET product_id=? WHERE product_id=? AND warehouse_id=?",
        (target, dup_id, soyo),
    )
    n = c.rowcount
    if n:
        c.execute(
            "UPDATE products SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (dup_id,),
        )
        merged += n
        print(f"merged {n} movements {sku} -> {base} ({target})")

conn.commit()
print("total movement rows reassigned:", merged)

c.execute(
    """SELECT SUM(CASE WHEN movement_type='IN' THEN quantity
                      WHEN movement_type='OUT' THEN -quantity ELSE 0 END) AS stock,
              p.sku, p.name, p.is_active
       FROM stock_movements sm JOIN products p ON p.id=sm.product_id
       WHERE sm.warehouse_id=? AND LOWER(TRIM(p.sku))='106000039'
       GROUP BY p.id""",
    (soyo,),
)
print("=== after repair ledger @ soyo for 106000039 ===")
for r in c.fetchall():
    print(r)

conn.close()
