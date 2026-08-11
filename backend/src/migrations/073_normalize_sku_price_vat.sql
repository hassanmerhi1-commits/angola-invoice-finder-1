-- One selling price and one IVA per product (canonical SKU), company-wide.
--
-- Branch rows are meant to follow the HQ/catalog price unless that branch explicitly opted out
-- (price_override / vat_override). Years of imports, purchases, stock entries and a filial repair
-- job wrote prices and IVA straight onto individual branch rows, so the same SKU ended up with a
-- different price/IVA per branch; the inventory grid then hid that by displaying a MAX across the
-- duplicate rows, which is why the grid and the product dialog disagreed and why an IVA changed to
-- 14% looked like it "went back to 5%" somewhere else.
--
-- Converge every non-overridden row onto the master (HQ/catalog) value, falling back to the most
-- recently edited row when no master carries one. Rows with a real per-branch override are left
-- untouched.

WITH keyed AS (
  SELECT
    p.id,
    LOWER(TRIM(
      CASE
        WHEN TRIM(COALESCE(p.sku, '')) = '' THEN p.id::text
        WHEN POSITION('-dup-' IN LOWER(TRIM(COALESCE(p.sku, '')))) > 0
          THEN TRIM(SUBSTRING(
            TRIM(COALESCE(p.sku, ''))
            FROM 1 FOR POSITION('-dup-' IN LOWER(TRIM(COALESCE(p.sku, '')))) - 1
          ))
        ELSE TRIM(COALESCE(p.sku, ''))
      END
    )) AS sku_key,
    CASE WHEN p.branch_id IS NULL OR b.is_main IS TRUE THEN 0 ELSE 1 END AS master_rank,
    p.price,
    p.price2,
    p.price3,
    p.price4,
    p.tax_rate,
    p.updated_at,
    p.created_at
  FROM products p
  LEFT JOIN branches b ON b.id::text = p.branch_id::text
  WHERE COALESCE(p.is_active, TRUE)
    AND TRIM(COALESCE(p.sku, '')) <> ''
),
price_pick AS (
  SELECT DISTINCT ON (sku_key)
    sku_key,
    price,
    price2,
    price3,
    price4
  FROM keyed
  WHERE COALESCE(price, 0) > 0.0001
  ORDER BY sku_key, master_rank, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
)
UPDATE products t
SET price = pp.price,
    price2 = COALESCE(NULLIF(pp.price2, 0), t.price2),
    price3 = COALESCE(NULLIF(pp.price3, 0), t.price3),
    price4 = COALESCE(NULLIF(pp.price4, 0), t.price4),
    updated_at = CURRENT_TIMESTAMP
FROM keyed k
JOIN price_pick pp ON pp.sku_key = k.sku_key
WHERE k.id = t.id
  AND COALESCE(t.price_override, FALSE) = FALSE
  AND ABS(COALESCE(t.price, 0) - pp.price) > 0.0001;

WITH keyed AS (
  SELECT
    p.id,
    LOWER(TRIM(
      CASE
        WHEN TRIM(COALESCE(p.sku, '')) = '' THEN p.id::text
        WHEN POSITION('-dup-' IN LOWER(TRIM(COALESCE(p.sku, '')))) > 0
          THEN TRIM(SUBSTRING(
            TRIM(COALESCE(p.sku, ''))
            FROM 1 FOR POSITION('-dup-' IN LOWER(TRIM(COALESCE(p.sku, '')))) - 1
          ))
        ELSE TRIM(COALESCE(p.sku, ''))
      END
    )) AS sku_key,
    p.tax_rate,
    p.updated_at,
    p.created_at
  FROM products p
  WHERE COALESCE(p.is_active, TRUE)
    AND TRIM(COALESCE(p.sku, '')) <> ''
),
vat_pick AS (
  SELECT DISTINCT ON (sku_key)
    sku_key,
    tax_rate
  FROM keyed
  WHERE tax_rate IS NOT NULL
  -- A rate somebody actually chose (0/7/14) beats the legacy 5% default that imports wrote.
  ORDER BY sku_key,
    CASE WHEN ABS(tax_rate - 5) > 0.0001 THEN 0 ELSE 1 END,
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST
)
UPDATE products t
SET tax_rate = vp.tax_rate,
    updated_at = CURRENT_TIMESTAMP
FROM keyed k
JOIN vat_pick vp ON vp.sku_key = k.sku_key
WHERE k.id = t.id
  AND COALESCE(t.vat_override, FALSE) = FALSE
  AND (t.tax_rate IS NULL OR ABS(t.tax_rate - vp.tax_rate) > 0.0001);

-- Keep tax_code in step with the rate that was just written.
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_code VARCHAR(20);

UPDATE products
SET tax_code = 'IVA' || CAST(ROUND(tax_rate) AS INTEGER)
WHERE tax_rate IS NOT NULL
  AND COALESCE(tax_code, '') <> 'IVA' || CAST(ROUND(tax_rate) AS INTEGER);
