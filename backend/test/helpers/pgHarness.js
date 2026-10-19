/**
 * Optional disposable PostgreSQL harness.
 * Never connects unless NEXOR_TEST_DATABASE_URL is a safe test database.
 */
function isSafeDisposablePgUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/kwanza_erp/i.test(raw)) return false;
  if (/nexor[\\/]erp\.db/i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    const dbName = String(parsed.pathname || '').replace(/^\//, '').split('?')[0];
    return dbName === 'nexor_erp_test';
  } catch {
    return false;
  }
}

function getDisposablePgUrl() {
  const url = String(process.env.NEXOR_TEST_DATABASE_URL || '').trim();
  if (!isSafeDisposablePgUrl(url)) return null;
  return url;
}

module.exports = {
  isSafeDisposablePgUrl,
  getDisposablePgUrl,
};
