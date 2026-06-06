/**
 * Resolve login identifier (username or email) to a users row.
 */
function buildLoginEmailCandidates(raw) {
  const trimmed = String(raw || '').trim().toLowerCase();
  if (!trimmed) return [];
  const localPart = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const candidates = new Set();
  if (trimmed.includes('@')) candidates.add(trimmed);
  candidates.add(`${localPart}@kwanzaerp.ao`);
  candidates.add(`${localPart}@nexor.local`);
  return [...candidates];
}

const { activeUserWhere } = require('./sqlDialect');

async function findUserForLogin(db, rawIdentifier) {
  const ACTIVE_USER_SQL = activeUserWhere(db);
  const trimmed = String(rawIdentifier || '').trim().toLowerCase();
  if (!trimmed) return null;

  const localPart = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;

  const tryQuery = async (sql, params) => {
    const result = await db.query(sql, params);
    return result.rows[0] || null;
  };

  // 1) Exact email (e.g. joao@company.com)
  if (trimmed.includes('@')) {
    const hit = await tryQuery(
      `SELECT * FROM users WHERE ${ACTIVE_USER_SQL} AND LOWER(email) = $1 LIMIT 1`,
      [trimmed],
    );
    if (hit) return hit;
  }

  // 2) Username column (when present)
  try {
    const byUsername = await tryQuery(
      `SELECT * FROM users WHERE ${ACTIVE_USER_SQL} AND LOWER(username) = $1 LIMIT 1`,
      [trimmed],
    );
    if (byUsername) return byUsername;
  } catch (_) {
    /* username column may not exist yet */
  }

  // 3) Email local part — "joao" matches joao@company.com
  if (localPart) {
    const byLocal = await tryQuery(
      `SELECT * FROM users WHERE ${ACTIVE_USER_SQL} AND LOWER(email) LIKE $1 LIMIT 1`,
      [`${localPart}@%`],
    );
    if (byLocal) return byLocal;
  }

  // 4) Legacy default domains (admin → admin@kwanzaerp.ao)
  for (const email of buildLoginEmailCandidates(trimmed)) {
    const hit = await tryQuery(
      `SELECT * FROM users WHERE ${ACTIVE_USER_SQL} AND LOWER(email) = $1 LIMIT 1`,
      [email],
    );
    if (hit) return hit;
  }

  return null;
}

module.exports = { buildLoginEmailCandidates, findUserForLogin };
