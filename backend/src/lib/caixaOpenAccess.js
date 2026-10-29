/**
 * Who may open a till shift.
 * Cashiers have pos_access only — not caixa_open — so shift open and the
 * default-register ensure must accept pos_access. Editing register settings
 * (name, limits) stays on caixa_open / admin_settings.
 */
const { userHasPermission } = require('./rolePermissions');

const SESSION_OPEN_PERMISSIONS = ['caixa_open', 'pos_access'];
const REGISTER_ENSURE_PERMISSIONS = ['caixa_open', 'admin_settings', 'pos_access'];
const REGISTER_SETTINGS_PERMISSIONS = ['caixa_open', 'admin_settings'];

function allowsAny(role, overrides, permissionIds) {
  return permissionIds.some((id) => userHasPermission(role, overrides, id));
}

/** Drawer count. Zero is a real float (empty drawer), not a missing value. */
function openingBalanceOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  SESSION_OPEN_PERMISSIONS,
  REGISTER_ENSURE_PERMISSIONS,
  REGISTER_SETTINGS_PERMISSIONS,
  allowsAny,
  openingBalanceOrZero,
};
