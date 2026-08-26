/**
 * USB / folder sneakernet packages (nexor-up, nexor-down).
 * Stock on down-packages is a POS snapshot only — never applied as ledger movements.
 */

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fnv1aHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function checksumOf(obj) {
  return fnv1aHex(stableStringify(obj));
}

function withChecksum(body) {
  const { checksum: _ignored, ...rest } = body;
  return { ...rest, checksum: checksumOf(rest) };
}

function verifyChecksum(pkg) {
  if (!pkg || typeof pkg !== 'object') return { ok: false, error: 'invalid package' };
  const { checksum, ...rest } = pkg;
  if (!checksum || checksum !== checksumOf(rest)) {
    return { ok: false, error: 'checksum mismatch' };
  }
  return { ok: true };
}

function buildDownPackage({ branchId, branchName, appVersion, data }) {
  const products = Array.isArray(data?.products) ? data.products : [];
  const clients = Array.isArray(data?.clients) ? data.clients : [];
  const stockSnapshot = products.map((p) => ({
    productId: p.id,
    sku: p.sku,
    stock: Number(p.stock) || 0,
  }));
  return withChecksum({
    kind: 'nexor-down',
    version: 1,
    stockSnapshotOnly: true,
    fromBranchId: branchId || null,
    toBranchId: branchId || null,
    branchName: branchName || null,
    generatedAt: new Date().toISOString(),
    appVersion: appVersion || null,
    products,
    clients,
    stockSnapshot,
    counts: {
      products: products.length,
      clients: clients.length,
      stockSnapshot: stockSnapshot.length,
    },
  });
}

function verifyUpPackage(pkg) {
  const check = verifyChecksum(pkg);
  if (!check.ok) return check;
  if (pkg.kind !== 'nexor-up') return { ok: false, error: 'expected nexor-up package' };
  if (!Array.isArray(pkg.events)) return { ok: false, error: 'events array required' };
  return { ok: true };
}

function verifyDownPackage(pkg) {
  const check = verifyChecksum(pkg);
  if (!check.ok) return check;
  if (pkg.kind !== 'nexor-down') return { ok: false, error: 'expected nexor-down package' };
  return { ok: true };
}

module.exports = {
  checksumOf,
  withChecksum,
  verifyChecksum,
  buildDownPackage,
  verifyUpPackage,
  verifyDownPackage,
};
