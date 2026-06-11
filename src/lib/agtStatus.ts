/** AGT transmission states that mean the document was already sent/validated. */
const VALIDATED_STATUSES = new Set(['validated', 'approved', 'submitted']);

export function isAgtValidated(status?: string | null): boolean {
  if (!status) return false;
  return VALIDATED_STATUSES.has(String(status).toLowerCase());
}

export function normalizeAgtStatus(status?: string | null): string | undefined {
  if (!status) return undefined;
  return String(status).toLowerCase();
}
