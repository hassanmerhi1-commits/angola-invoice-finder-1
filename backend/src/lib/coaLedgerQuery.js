/**
 * Fast CoA account ledger — single account, date-bounded, index-friendly.
 * Never expands children. Never holds a pool connection in an extra BEGIN.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

async function fetchAccountLedger(db, root, {
  start_date,
  end_date,
  limit = 50,
  before_date,
  before_id,
}) {
  const idText = (col) => (db.engine === 'postgres' ? `${col}::text` : `CAST(${col} AS TEXT)`);
  const postedClause = db.engine === 'postgres'
    ? '(je.is_posted IS DISTINCT FROM false)'
    : '(je.is_posted = 1 OR je.is_posted IS NULL OR je.is_posted = true)';
  const entryDateExpr = db.engine === 'postgres'
    ? `COALESCE(
        NULLIF(TRIM(je.entry_date::text), ''),
        CASE WHEN je.created_at IS NOT NULL THEN to_char(je.created_at::date, 'YYYY-MM-DD') END
      )`
    : `COALESCE(NULLIF(TRIM(CAST(je.entry_date AS TEXT)), ''), substr(CAST(je.created_at AS TEXT), 1, 10))`;

  const codeStr = String(root.code || '');
  const isHeader =
    root.is_header === true || root.is_header === 1 || root.is_header === '1';
  const isHighVolumeParent =
    isHeader
    || /^(11|43|45|31|32|61|62|63|311|321|3452)/.test(codeStr);

  let startDate = start_date ? String(start_date).slice(0, 10) : '';
  let endDate = end_date ? String(end_date).slice(0, 10) : '';
  let defaultedRange = false;

  if (!startDate || !endDate) {
    const to = new Date();
    const from = new Date(to);
    const days = isHighVolumeParent || /^(43|45)/.test(codeStr) ? 7 : 30;
    from.setUTCDate(from.getUTCDate() - days);
    startDate = startDate || from.toISOString().slice(0, 10);
    endDate = endDate || to.toISOString().slice(0, 10);
    defaultedRange = true;
  }

  try {
    const fromMs = new Date(startDate).getTime();
    const toMs = new Date(endDate).getTime();
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs - fromMs > 366 * 86400000) {
      const to = new Date(endDate);
      const from = new Date(to);
      from.setUTCDate(from.getUTCDate() - 30);
      startDate = from.toISOString().slice(0, 10);
      defaultedRange = true;
    }
  } catch {
    /* ignore */
  }

  const accountId = String(root.id);
  const hardLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
  const beforeDate = before_date ? String(before_date).slice(0, 10) : '';
  const beforeId = before_id ? String(before_id).trim() : '';
  const pgAccountPred = looksLikeUuid(accountId)
    ? 'account_id = $1::uuid'
    : 'account_id::text = $1::text';

  const params = [accountId, startDate, endDate, hardLimit];
  let cursorSql = '';
  if (beforeDate) {
    params.push(beforeDate);
    const dateIdx = params.length;
    if (beforeId) {
      params.push(beforeId);
      cursorSql = ` AND (entry_date < $${dateIdx}::date OR (entry_date = $${dateIdx}::date AND id::text < $${params.length}::text))`;
    } else {
      cursorSql = ` AND entry_date < $${dateIdx}::date`;
    }
  }

  let rawRows = [];
  if (db.engine === 'postgres') {
    // Limit on the line index FIRST, then join headers — never sort the full cash history.
    const result = await db.query(
      `SELECT
         jel.id,
         jel.journal_entry_id,
         jel.account_id,
         jel.description,
         jel.debit_amount,
         jel.credit_amount,
         je.entry_number,
         COALESCE(jel.entry_date, je.entry_date)::text AS entry_date,
         je.description AS journal_description,
         je.reference_type,
         je.reference_id,
         je.branch_id,
         je.created_by,
         je.created_by_name,
         je.is_posted,
         je.created_at AS journal_created_at
       FROM (
         SELECT id, journal_entry_id, account_id, description, debit_amount, credit_amount, entry_date
         FROM journal_entry_lines
         WHERE ${pgAccountPred}
           AND entry_date >= $2::date
           AND entry_date <= $3::date
           ${cursorSql}
         ORDER BY entry_date DESC NULLS LAST, id DESC
         LIMIT $4
       ) jel
       INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE ${postedClause}
       ORDER BY jel.entry_date DESC NULLS LAST, je.created_at DESC`,
      params,
    );
    rawRows = result.rows || [];
  } else {
    const result = await db.query(
      `SELECT
         jel.id,
         jel.journal_entry_id,
         jel.account_id,
         jel.description,
         jel.debit_amount,
         jel.credit_amount,
         je.entry_number,
         ${entryDateExpr} AS entry_date,
         je.description AS journal_description,
         je.reference_type,
         je.reference_id,
         je.branch_id,
         je.created_by,
         je.created_by_name,
         je.is_posted,
         je.created_at AS journal_created_at
       FROM journal_entry_lines jel
       INNER JOIN journal_entries je ON ${idText('je.id')} = ${idText('jel.journal_entry_id')}
       WHERE ${idText('jel.account_id')} = ${idText('$1')}
         AND (${entryDateExpr}) >= $2
         AND (${entryDateExpr}) <= $3
         AND ${postedClause}
       ORDER BY (${entryDateExpr}) DESC, je.created_at DESC
       LIMIT $4`,
      [accountId, startDate, endDate, hardLimit],
    );
    rawRows = result.rows || [];
  }

  const branchIds = [...new Set(rawRows.map((r) => String(r.branch_id || '').trim()).filter(Boolean))];
  const branchNameById = new Map();
  if (branchIds.length > 0) {
    try {
      const br = db.engine === 'postgres'
        ? await db.query(
          `SELECT id::text AS id, name FROM branches WHERE id::text = ANY($1::text[])`,
          [branchIds],
        )
        : await db.query(
          `SELECT CAST(id AS TEXT) AS id, name FROM branches WHERE CAST(id AS TEXT) IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`,
          branchIds,
        );
      for (const b of br.rows || []) {
        branchNameById.set(String(b.id), b.name);
      }
    } catch {
      /* ignore */
    }
  }

  let rows = rawRows.map((row) => ({
    ...row,
    branch_name: branchNameById.get(String(row.branch_id || '').trim()) || null,
    created_by: row.created_by || '',
    created_by_name: row.created_by_name || '',
    account_code: root.code,
    account_name: root.name,
  }));

  const missingSaleUserIds = [...new Set(
    rows
      .filter((row) => row.reference_type === 'sale' && !String(row.created_by_name || '').trim())
      .map((row) => String(row.reference_id || '').trim())
      .filter(Boolean),
  )];
  if (missingSaleUserIds.length > 0) {
    try {
      const salesResult = db.engine === 'postgres'
        ? await db.query(
          `SELECT id::text AS id, created_by::text AS created_by, COALESCE(created_by_name, '') AS created_by_name
           FROM sales
           WHERE id::text = ANY($1::text[])`,
          [missingSaleUserIds],
        )
        : await db.query(
          `SELECT CAST(id AS TEXT) AS id, CAST(created_by AS TEXT) AS created_by, COALESCE(created_by_name, '') AS created_by_name
           FROM sales
           WHERE CAST(id AS TEXT) IN (${missingSaleUserIds.map((_, i) => `$${i + 1}`).join(',')})`,
          missingSaleUserIds,
        );
      const saleById = new Map(
        (salesResult.rows || []).map((row) => [String(row.id || '').trim(), row]),
      );
      rows = rows.map((row) => {
        if (row.reference_type !== 'sale' || String(row.created_by_name || '').trim()) return row;
        const sale = saleById.get(String(row.reference_id || '').trim());
        if (!sale) return row;
        return {
          ...row,
          created_by: row.created_by || sale.created_by || '',
          created_by_name: sale.created_by_name || row.created_by_name || '',
        };
      });
    } catch {
      /* ignore */
    }
  }

  if (rows.length === 0 && !isHeader && !beforeDate) {
    const opening = Number(root.opening_balance) || 0;
    const stored = Number(root.current_balance) || 0;
    if (opening !== 0 || stored !== 0) {
      const amt = opening !== 0 ? opening : stored;
      rows = [{
        id: `opening-${root.id}`,
        journal_entry_id: null,
        account_id: root.id,
        account_code: root.code,
        account_name: root.name,
        description: 'Saldo de abertura',
        debit_amount: amt > 0 ? amt : 0,
        credit_amount: amt < 0 ? Math.abs(amt) : 0,
        entry_number: 'OPEN',
        entry_date: '',
        journal_description: 'Opening balance',
        reference_type: 'opening',
        reference_id: null,
        created_by: '',
        created_by_name: '',
        is_posted: true,
        journal_created_at: null,
      }];
    }
  }

  return {
    rows,
    hardLimit,
    startDate,
    endDate,
    defaultedRange,
    isHeader,
    isHighVolumeParent,
  };
}

module.exports = { fetchAccountLedger };
