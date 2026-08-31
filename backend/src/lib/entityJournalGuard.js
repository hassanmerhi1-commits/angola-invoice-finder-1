/**
 * A 321/311 account code can reach the server inside client-supplied journal lines,
 * so it may name a different party than the document does. This re-resolves the code
 * from the document's own party and overrides anything that belongs to somebody else.
 *
 * Posting a purchase to another supplier's ledger is how BASEL ANGOLA's invoices ended
 * up credited to ABRICOME, so every path that accepts journal lines runs this.
 */
const ENTITY_LINE = /^(321|311)\d+$/;

function lineCode(line) {
  return String(line.accountCode || line.account_code || '').trim();
}

function setLineCode(line, code) {
  if (line.account_code !== undefined) line.account_code = code;
  if (line.accountCode !== undefined || line.account_code === undefined) line.accountCode = code;
}

function normalizeType(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'supplier' || raw === 'fornecedor') return 'supplier';
  if (raw === 'customer' || raw === 'client' || raw === 'cliente') return 'customer';
  return null;
}

/**
 * @param context { entityType?, entityId?, entityName? } — the party the document is for.
 * @param warnings collects messages for the caller to surface or log.
 * @returns number of lines re-pointed.
 */
async function alignEntityJournalAccounts(client, journalLines, context = {}, warnings = []) {
  const candidates = (journalLines || []).filter((line) => ENTITY_LINE.test(lineCode(line)));
  if (candidates.length === 0) return 0;

  const name = String(context.entityName || '').trim();
  const id = String(context.entityId || '').trim();
  // A manual journal with no party attached is the accountant's choice — leave it.
  if (!name && !id) return 0;

  const {
    resolveEntityAccountCode,
    findEntityLeafCode,
    namesRelated,
    normalizeEntityName,
  } = require('./entityCoaAccounts');
  const declaredType = normalizeType(context.entityType);
  const want = normalizeEntityName(name);
  const expectedCache = new Map();

  let changed = 0;
  for (const line of candidates) {
    const code = lineCode(line);
    const group = code.startsWith('311') ? '311' : '321';
    const lineType = group === '311' ? 'customer' : 'supplier';
    // Never judge a customer line by a supplier's identity, or the reverse.
    if (declaredType && declaredType !== lineType) continue;

    if (!expectedCache.has(lineType)) {
      let expected = null;
      try {
        expected = declaredType
          // The party's kind is known, so the account may be created if missing.
          ? await resolveEntityAccountCode(client, lineType, id || null, name)
          // Kind only inferred from the code: reuse an existing account, never invent
          // one, so a supplier name cannot grow a customer account.
          : await findEntityLeafCode(client, group === '311' ? '31' : '32', group, name, null);
      } catch (e) {
        warnings.push(`Conta de ${lineType === 'supplier' ? 'fornecedor' : 'cliente'} não resolvida (${e.message}) — código recebido mantido`);
      }
      expectedCache.set(lineType, ENTITY_LINE.test(String(expected || '')) ? expected : null);
    }

    const expected = expectedCache.get(lineType);
    if (!expected || expected === code) continue;

    const owner = await client.query(
      `SELECT name FROM chart_of_accounts WHERE code = $1 LIMIT 1`,
      [code],
    ).catch(() => ({ rows: [] }));
    const ownerLabel = owner.rows[0] ? String(owner.rows[0].name || '') : '';
    if (ownerLabel && want && namesRelated(want, normalizeEntityName(ownerLabel))) continue;

    setLineCode(line, expected);
    changed += 1;
    warnings.push(
      `Conta ${code}${ownerLabel ? ` (${ownerLabel})` : ''} não pertence a ${name} — lançado em ${expected}`,
    );
  }
  return changed;
}

module.exports = { alignEntityJournalAccounts };
