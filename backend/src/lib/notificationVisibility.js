const { userHasPermission } = require('./rolePermissions');

/**
 * Which notification types a user may read.
 *
 * `null` means unrestricted — the operational alerts (overdue receivables, period
 * close, AGT failures) are management business. A cashier only needs the answer to
 * the expense they asked about, so they get that and nothing else. A restricted user
 * also never sees broadcast rows, only notifications addressed to them personally.
 */
function visibleNotificationTypes(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  if (role !== 'cashier') return null;
  const types = ['approval_result'];
  // A cashier explicitly granted approval rights still has requests to act on.
  if (userHasPermission(role, user?.permissionOverrides, 'expense_approve')) {
    types.push('approval_pending');
  }
  return types;
}

/** True when this user may only ever see their own notifications. */
function isRestrictedToOwnNotifications(user) {
  return visibleNotificationTypes(user) !== null;
}

module.exports = { visibleNotificationTypes, isRestrictedToOwnNotifications };
