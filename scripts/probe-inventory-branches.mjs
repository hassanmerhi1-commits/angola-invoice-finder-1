const BASE = process.env.NEXOR_API_URL || 'http://127.0.0.1:3000';

async function get(path) {
  const res = await fetch(`${BASE}/api${path}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

function topStock(rows, n = 5) {
  return [...rows]
    .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0))
    .slice(0, n)
    .map((r) => ({ sku: r.sku, stock: r.stock, name: String(r.name || '').slice(0, 40) }));
}

async function main() {
  const branches = await get('/branches');
  console.log('Branches:', branches.length);
  for (const b of branches) {
    console.log(`  ${b.id} | ${b.code || '-'} | ${b.name} | main=${b.is_main}`);
  }

  const samples = [];
  for (const b of branches) {
    const data = await get(`/products/inventory-grid?branchId=${encodeURIComponent(b.id)}`);
    const rows = data.rows || [];
    samples.push({
      id: b.id,
      code: b.code,
      name: b.name,
      count: rows.length,
      top: topStock(rows),
      stockSum: rows.reduce((s, r) => s + (Number(r.stock) || 0), 0),
    });
  }

  const consolidated = await get('/products/inventory-grid?consolidated=1');
  const cRows = consolidated.rows || [];
  console.log('\nConsolidated count:', cRows.length, 'stockSum:', cRows.reduce((s, r) => s + (Number(r.stock) || 0), 0));

  console.log('\nPer-branch comparison:');
  for (const s of samples) {
    console.log(`\n${s.code} (${s.name}) — ${s.count} rows, stockSum=${s.stockSum}`);
    for (const t of s.top) console.log(`  ${t.sku} qty=${t.stock} ${t.name}`);
  }

  // Same SKU across branches?
  const sku = samples[0]?.top[0]?.sku;
  if (sku) {
    console.log(`\nSKU "${sku}" across branches:`);
    for (const b of branches) {
      const data = await get(`/products/inventory-grid?branchId=${encodeURIComponent(b.id)}`);
      const row = (data.rows || []).find((r) => r.sku === sku);
      console.log(`  ${b.code}: ${row ? row.stock : 'NOT IN LIST'}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
