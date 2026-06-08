import sqlite3

db = r"C:\NEXOR ERP\data\erp.db"
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
c = conn.cursor()
soyo = "6817b070682200927fa9e8e5fae7295c"

c.execute(
    """SELECT id, name, sku, branch_id, is_active FROM products
       WHERE name LIKE '%ACUCAR ALIMO%' OR sku LIKE '106000039%'"""
)
print("=== products ===")
for r in c.fetchall():
    print(dict(r))

c.execute(
    """SELECT sm.product_id, p.sku, sm.movement_type, sm.quantity, sm.reference_number
       FROM stock_movements sm JOIN products p ON p.id=sm.product_id
       WHERE sm.warehouse_id=? AND (p.sku LIKE '106000039%' OR p.name LIKE '%ACUCAR ALIMO%')
       ORDER BY sm.created_at""",
    (soyo,),
)
print("=== soyo movements ===")
for r in c.fetchall():
    print(dict(r))
