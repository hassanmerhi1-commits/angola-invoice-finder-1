#!/usr/bin/env python3
"""Diagnose one SKU across NEXOR SQLite DB copies."""
import os
import sqlite3
import sys

SKU = (sys.argv[1] if len(sys.argv) > 1 else "101000068").strip()
PATHS = [
    r"C:\NEXOR ERP\data\erp.db",
    r"C:\nexor\erp.db",
    os.path.expandvars(r"%APPDATA%\NEXOR ERP\data\erp.db"),
]


def canonical(sku: str) -> str:
    import re
    s = (sku or "").strip()
    return re.sub(r"-DUP-[a-f0-9]+$", "", s, flags=re.I).strip() or s


def ledger(c, warehouse_id: str, sku: str) -> float:
    row = c.execute(
        """
        SELECT COALESCE(SUM(
          CASE
            WHEN sm.movement_type = 'IN' THEN sm.quantity
            WHEN sm.movement_type = 'OUT' THEN -sm.quantity
            ELSE 0
          END
        ), 0) AS total
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        WHERE sm.warehouse_id = ?
          AND (
            LOWER(TRIM(COALESCE(p.sku, ''))) = LOWER(?)
            OR LOWER(TRIM(COALESCE(p.sku, ''))) LIKE LOWER(?) || '-DUP-%'
          )
        """,
        (warehouse_id, sku, sku),
    ).fetchone()
    return float(row[0] or 0)


def diag(path: str) -> None:
    if not os.path.isfile(path):
        print(f"MISSING {path}")
        return
    print(f"\n{'=' * 60}\n{path} ({os.path.getsize(path):,} bytes)\n{'=' * 60}")
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row

    prods = c.execute(
        """
        SELECT id, name, sku, branch_id, stock, is_active, price, cost, updated_at
        FROM products
        WHERE LOWER(TRIM(sku)) = LOWER(?)
           OR LOWER(TRIM(sku)) LIKE LOWER(?) || '-DUP-%'
        ORDER BY COALESCE(is_active, 1) DESC, branch_id, sku
        """,
        (SKU, SKU),
    ).fetchall()
    print(f"\nProduct rows ({len(prods)}):")
    for r in prods:
        d = dict(r)
        d["canonical"] = canonical(d.get("sku") or "")
        print(f"  {d}")

    branches = c.execute(
        "SELECT id, name, code, is_main FROM branches WHERE COALESCE(is_active, 1) != 0 ORDER BY name"
    ).fetchall()
    print("\nLedger stock by branch:")
    for b in branches:
        wh = b["id"]
        led = ledger(c, wh, SKU)
        if abs(led) < 0.0001:
            continue
        print(f"  {b['name']} ({wh}): ledger={led}")

    print("\nRecent movements (last 15):")
    movs = c.execute(
        """
        SELECT sm.created_at, sm.warehouse_id, b.name AS wh_name,
               sm.movement_type, sm.quantity, sm.reference_type, sm.reference_number,
               p.sku, p.id AS product_id
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN branches b ON b.id = sm.warehouse_id
        WHERE LOWER(TRIM(p.sku)) = LOWER(?)
           OR LOWER(TRIM(p.sku)) LIKE LOWER(?) || '-DUP-%'
        ORDER BY sm.created_at DESC
        LIMIT 15
        """,
        (SKU, SKU),
    ).fetchall()
    for m in movs:
        print(f"  {dict(m)}")

    for label, sql in [
        (
            "stock_transfers",
            """
            SELECT transfer_number, status, from_branch_name, to_branch_name
            FROM stock_transfers
            WHERE lines_json LIKE '%' || ? || '%'
            LIMIT 5
            """,
        ),
        (
            "sales",
            """
            SELECT invoice_number, branch_id, substr(items_json, 1, 200) AS items
            FROM sales
            WHERE items_json LIKE '%' || ? || '%'
            LIMIT 3
            """,
        ),
    ]:
        try:
            rows = c.execute(sql, (SKU,)).fetchall()
            if rows:
                print(f"\n{label}:")
                for row in rows:
                    print(f"  {dict(row)}")
        except sqlite3.OperationalError:
            pass

    try:
        pis = c.execute(
            """
            SELECT id, invoice_number, warehouse_id, branch_id, change_price, substr(lines_json, 1, 400) AS lines
            FROM purchase_invoices
            WHERE lines_json LIKE '%' || ? || '%'
            ORDER BY date DESC
            LIMIT 5
            """,
            (SKU,),
        ).fetchall()
        if pis:
            print("\nPurchase invoices mentioning SKU:")
            for row in pis:
                print(f"  {dict(row)}")
    except sqlite3.OperationalError:
        pass

    c.close()


if __name__ == "__main__":
    for p in PATHS:
        diag(p)
