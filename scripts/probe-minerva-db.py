#!/usr/bin/env python3
"""Probe Minerva ERP database files under C:\\Minerva."""
import os
import re
import struct
import sys

MINERVA = r"C:\Minerva"


def extract_ascii_strings(path: str, min_len: int = 4) -> list[str]:
    data = open(path, "rb").read()
    return re.findall(rb"[\x20-\x7e]{%d,}" % min_len, data)


def probe_firebird(path: str) -> None:
    os.environ["FIREBIRD_CLIENT_LIBRARY"] = os.path.join(MINERVA, "gds32.dll")
    try:
        from firebird.driver import connect
    except ImportError:
        print("firebird-driver not installed")
        return
    for pwd in ("masterkey", "minerva", "MINERVA", "admin", ""):
        try:
            con = connect(database=path, user="SYSDBA", password=pwd, charset="UTF8")
            cur = con.cursor()
            cur.execute(
                """
                SELECT TRIM(r.RDB$RELATION_NAME)
                FROM RDB$RELATIONS r
                WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0
                  AND r.RDB$VIEW_BLR IS NULL
                ORDER BY 1
                """
            )
            tables = [row[0].strip() for row in cur.fetchall()]
            print(f"OK Firebird {path} password={pwd!r} tables={len(tables)}")
            for t in tables:
                print(f"  {t}")
            con.close()
            return
        except Exception as e:
            print(f"  try pwd={pwd!r}: {type(e).__name__}: {e}")


def scan_ibx(path: str) -> None:
    print(f"\n=== IBX index file: {path} ===")
    strings = [s.decode("ascii", "ignore") for s in extract_ascii_strings(path, 6)]
    keywords = [s for s in strings if re.match(r"^[A-Z][A-Z0-9_]{2,}$", s)]
    for s in sorted(set(keywords))[:80]:
        print(f"  {s}")


def scan_dol_strings(path: str, limit: int = 60) -> None:
    print(f"\n=== DOL strings sample: {os.path.basename(path)} ({os.path.getsize(path)} bytes) ===")
    strings = [s.decode("latin-1", "ignore") for s in extract_ascii_strings(path, 5)]
    table_like = sorted(
        {s for s in strings if re.match(r"^[A-Z][A-Z0-9_]{2,31}$", s) and not s.startswith("RDB")}
    )
    for s in table_like[:limit]:
        print(f"  {s}")


def main() -> None:
    targets = [
        os.path.join(MINERVA, "POSPREMIER.GDB"),
        os.path.join(MINERVA, "SOYO.DOL"),
        os.path.join(MINERVA, "COMPANY.db"),
        os.path.join(MINERVA, "sub.db"),
        os.path.join(MINERVA, "sub.IBX"),
        os.path.join(MINERVA, "company.IBX"),
        os.path.join(MINERVA, "allitem.db"),
    ]
    for p in targets:
        if not os.path.isfile(p):
            continue
        if p.upper().endswith((".GDB", ".DOL")):
            probe_firebird(p)
            if p.upper().endswith(".DOL"):
                scan_dol_strings(p)
        if p.upper().endswith(".IBX"):
            scan_ibx(p)
        if p.upper().endswith(".DB") and os.path.getsize(p) < 50_000_000:
            scan_dol_strings(p, 40)


if __name__ == "__main__":
    main()
