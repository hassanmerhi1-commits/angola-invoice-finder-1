const { userHasPermission } = require('./rolePermissions');

const CONFIRM_PERMISSION = 'purchase_invoice_confirm';
const PURCHASE_INVOICE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function isPurchaseInvoiceDraftStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return !s || s === 'draft' || s === 'pending';
}

/** Explicit unposted FC. Empty/legacy status is treated as already posted. */
function isPurchaseInvoiceUnpostedStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'draft' || s === 'pending';
}

function isAdminUser(user) {
  return String(user?.role || '').trim().toLowerCase() === 'admin';
}

function isWithinConfirmedEditWindow(createdAt, now = Date.now()) {
  const ms = createdAt instanceof Date
    ? createdAt.getTime()
    : Date.parse(String(createdAt || ''));
  if (!Number.isFinite(ms)) return false;
  return now - ms <= PURCHASE_INVOICE_EDIT_WINDOW_MS;
}

function canConfirmPurchaseInvoice(user) {
  return userHasPermission(user?.role, user?.permissionOverrides, CONFIRM_PERMISSION);
}

function sameUserId(a, b) {
  return String(a || '').trim() !== '' && String(a).trim() === String(b || '').trim();
}

/**
 * Who may write this FC, and whether stock/accounts should post.
 * Non-admin confirm requests are saved as draft instead of rejected.
 * Posted invoices: administrator only, and only within 24 hours of creation
 * (metadata-only updates such as mark-as-paid stay allowed for confirmers).
 */
function resolvePurchaseInvoiceWrite({ user, existing, requestedStatus, metadataOnly, now } = {}) {
  const canConfirm = canConfirmPurchaseInvoice(user);
  const existingStatus = existing ? String(existing.status || existing.Status || '') : '';
  const existingUnposted = !existing || isPurchaseInvoiceUnpostedStatus(existingStatus);
  const ownerId = existing?.created_by || existing?.createdBy || '';
  const isOwner = !existing || !ownerId || sameUserId(ownerId, user?.id);
  const createdAt = existing?.created_at || existing?.createdAt;

  if (existing && existingUnposted && !isOwner && !canConfirm) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Only the author or a user with confirm permission can edit this draft',
    };
  }

  if (existing && !existingUnposted) {
    if (metadataOnly === true) {
      if (!canConfirm) {
        return {
          ok: false,
          statusCode: 403,
          error: 'Only a user with confirm permission can change a confirmed purchase invoice',
        };
      }
    } else {
      if (!isAdminUser(user)) {
        return {
          ok: false,
          statusCode: 403,
          error: 'Only an administrator can edit a confirmed purchase invoice',
        };
      }
      if (!isWithinConfirmedEditWindow(createdAt, now)) {
        return {
          ok: false,
          statusCode: 403,
          error: 'Purchase invoices can only be edited within 24 hours of creation',
        };
      }
    }
  }

  const wantConfirm = String(requestedStatus || '').trim().toLowerCase() === 'confirmed';
  if (!wantConfirm || !canConfirm) {
    return { ok: true, status: 'draft', skipAccounting: true, canConfirm };
  }
  return { ok: true, status: 'confirmed', skipAccounting: false, canConfirm };
}

module.exports = {
  CONFIRM_PERMISSION,
  PURCHASE_INVOICE_EDIT_WINDOW_MS,
  isPurchaseInvoiceDraftStatus,
  isPurchaseInvoiceUnpostedStatus,
  isWithinConfirmedEditWindow,
  canConfirmPurchaseInvoice,
  resolvePurchaseInvoiceWrite,
};
