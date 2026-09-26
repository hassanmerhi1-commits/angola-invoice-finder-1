const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Person name for a stock line. A stored account id is never shown as the name. */
export function movementUserLabel(
  name?: string | null,
  id?: string | null,
  labels: { system?: string; missing?: string } = {},
): string {
  const systemLabel = labels.system ?? '—';
  const missingLabel = labels.missing ?? '—';
  const label = String(name || '').trim();
  if (label && !USER_ID_RE.test(label)) return label;
  const raw = String(id || '').trim();
  if (!raw || raw === 'system') return systemLabel;
  if (USER_ID_RE.test(raw)) return missingLabel;
  return raw;
}
