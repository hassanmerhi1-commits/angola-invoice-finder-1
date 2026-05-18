/**
 * Remove stale browser-side ERP data (localStorage) that can show "old" records
 * when the live SQLite database has already been wiped or replaced.
 * Preserves auth, setup, and connection settings.
 */

const PRESERVE_KEYS = new Set([
  'kwanza_setup_complete',
  'kwanza_auth_token',
  'kwanza_current_user',
  'kwanzaerp_current_user',
  'kwanza_server_config',
  'kwanza_client_config',
  'kwanza_api_url',
  'kwanza_is_server',
  'kwanza_force_api',
]);

const CLEAR_PREFIXES = ['kwanzaerp_', 'kwanza_notifications'];

export function clearLocalErpCache(): { removed: number; preserved: number } {
  if (typeof localStorage === 'undefined') {
    return { removed: 0, preserved: 0 };
  }

  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (PRESERVE_KEYS.has(key)) continue;
    if (key.startsWith('kwanza') && !PRESERVE_KEYS.has(key)) {
      const shouldClear =
        CLEAR_PREFIXES.some((p) => key.startsWith(p)) ||
        key.includes('purchase_invoices') ||
        key.includes('open_items') ||
        key.includes('payments') ||
        key.includes('daily_reports') ||
        key.includes('migrated_to_api');
      if (shouldClear) toRemove.push(key);
    }
  }

  for (const key of toRemove) {
    localStorage.removeItem(key);
  }

  return { removed: toRemove.length, preserved: PRESERVE_KEYS.size };
}
