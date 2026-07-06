/** True when an API error likely means the city server is unreachable (not a business rule failure). */
export function isNetworkErrorMessage(message: unknown): boolean {
  const msg = String(message || '').toLowerCase();
  if (!msg) return false;
  return /failed to fetch|network error|network:httpjson unavailable|abort|timeout|unreachable|socket|econnrefused|enotfound|enetunreach|etimedout|ehostunreach|getaddrinfo|connect\s+econn|could not connect|server_unreachable|failed to parse url|invalid url|err_name_not_resolved|err_connection/.test(
    msg,
  );
}
