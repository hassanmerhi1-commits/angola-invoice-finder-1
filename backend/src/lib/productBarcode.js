function trimProductBarcode(value) {
  return String(value ?? '').trim();
}

/** Keep the stored barcode when a later save/import/upsert sends blank. */
function mergeProductBarcode(incoming, existing) {
  const next = trimProductBarcode(incoming);
  if (next) return next;
  return trimProductBarcode(existing) || null;
}

module.exports = {
  trimProductBarcode,
  mergeProductBarcode,
};
