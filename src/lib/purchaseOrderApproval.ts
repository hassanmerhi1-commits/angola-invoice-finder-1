/** True when a PO can be approved from the UI (workflow or legacy pending). */
export function purchaseOrderNeedsApproval(status: string | undefined): boolean {
  const s = String(status || 'pending').trim().toLowerCase().replace(/\s+/g, '_');
  return s === 'awaiting_approval' || s === 'pending';
}
