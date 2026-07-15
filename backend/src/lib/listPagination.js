/** Shared limit/offset parsing for list endpoints. */
function parseListPagination(req, { defaultLimit = 200, maxLimit = 500 } = {}) {
  const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
  const rawOffset = parseInt(String(req.query.offset ?? ''), 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : defaultLimit, 1), maxLimit);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);
  return { limit, offset };
}

function parseTruthyQuery(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

module.exports = { parseListPagination, parseTruthyQuery };
