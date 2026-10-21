const { userHasPermission } = require('./rolePermissions');

const CONFIRM_PERMISSION = 'purchase_invoice_confirm';

function isPurchaseInvoiceDraftStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return !s || s === 'draft' || s === 'pending';
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
 */
function resolvePurchaseInvoiceWrite({ user, existing, requestedStatus }) {
  const canConfirm = canConfirmPurchaseInvoice(user);
  const existingStatus = existing ? String(existing.status || existing.Status || '') : '';
  const existingDraft = !existing || isPurchaseInvoiceDraftStatus(existingStatus);
  const ownerId = existing?.created_by || existing?.createdBy || '';
  const isOwner = !existing || !ownerId || sameUserId(ownerId, user?.id);

  if (existing && existingDraft && !isOwner && !canConfirm) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Only the author or a user with confirm permission can edit this draft',
    };
  }

  if (existing && !existingDraft && !canConfirm) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Only a user with confirm permission can change a confirmed purchase invoice',
    };
  }

  const wantConfirm = String(requestedStatus || '').trim().toLowerCase() === 'confirmed';
  if (!wantConfirm || !canConfirm) {
    return { ok: true, status: 'draft', skipAccounting: true, canConfirm };
  }
  return { ok: true, status: 'confirmed', skipAccounting: false, canConfirm };
}

module.exports = {
  CONFIRM_PERMISSION,
  isPurchaseInvoiceDraftStatus,
  canConfirmPurchaseInvoice,
  resolvePurchaseInvoiceWrite,
};
