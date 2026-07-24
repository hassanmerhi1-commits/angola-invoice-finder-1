/**
 * Bank statement auto-match scoring + CSV/XLSX row normalization.
 */

export type MatchDirection = 'in' | 'out';

export interface StatementLike {
  id: string;
  date: string;
  description: string;
  reference?: string;
  amount: number;
  direction: MatchDirection;
  matched?: boolean;
  matchedTransactionId?: string;
  matchConfidence?: number;
}

export interface SystemTxnLike {
  id: string;
  amount: number;
  direction: MatchDirection;
  transactionDate?: string;
  bankReference?: string;
  description?: string;
}

export interface MatchRule {
  id: string;
  name: string;
  pattern: string;
  matchField: 'description' | 'reference';
  priority: number;
  isActive: boolean;
}

/** Score a statement line against a system transaction (0–100+). */
export function scoreBankMatch(stmt: StatementLike, txn: SystemTxnLike, rules: MatchRule[] = []): number {
  if (Math.abs(txn.amount - stmt.amount) >= 0.01) return 0;
  if (txn.direction !== stmt.direction) return 0;

  let score = 50;
  if (txn.transactionDate && stmt.date && txn.transactionDate === stmt.date) score += 30;
  if (txn.bankReference && stmt.reference && txn.bankReference === stmt.reference) score += 20;

  const desc = String(txn.description || '').toLowerCase();
  const needle = String(stmt.description || '').toLowerCase().slice(0, 10);
  if (needle && desc.includes(needle)) score += 10;

  for (const rule of rules.filter((r) => r.isActive).sort((a, b) => a.priority - b.priority)) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      const field = rule.matchField === 'reference' ? stmt.reference || '' : stmt.description;
      if (re.test(field)) score += 15;
    } catch {
      // ignore bad regex
    }
  }
  return score;
}

export function autoMatchStatements(
  statements: StatementLike[],
  transactions: SystemTxnLike[],
  options: { rules?: MatchRule[]; minScore?: number; matchedIds?: Set<string> } = {},
): { rows: StatementLike[]; matchCount: number } {
  const minScore = options.minScore ?? 50;
  const matchedIds = options.matchedIds ?? new Set<string>();
  const rules = options.rules ?? [];
  let matchCount = 0;

  const rows = statements.map((row) => {
    if (row.matched) return row;
    let best: SystemTxnLike | null = null;
    let bestScore = 0;
    for (const t of transactions) {
      if (matchedIds.has(t.id)) continue;
      const score = scoreBankMatch(row, t, rules);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best && bestScore >= minScore) {
      matchCount += 1;
      matchedIds.add(best.id);
      return {
        ...row,
        matched: true,
        matchedTransactionId: best.id,
        matchConfidence: bestScore,
      };
    }
    return row;
  });

  return { rows, matchCount };
}

/** Parse a simple CSV bank statement (header row required). */
export function parseBankCsv(text: string): StatementLike[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (line: string) => {
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') {
        q = !q;
        continue;
      }
      if (ch === ',' && !q) {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = idx(['date', 'data']);
  const iDesc = idx(['desc', 'description', 'movimento', 'narration']);
  const iRef = idx(['ref', 'reference', 'referencia']);
  const iAmount = idx(['amount', 'valor']);
  const iCredit = idx(['credit', 'credito', 'crédito']);
  const iDebit = idx(['debit', 'debito', 'débito']);

  const rows: StatementLike[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = split(lines[i]);
    if (!cells.length) continue;
    const desc = iDesc >= 0 ? cells[iDesc] || '' : '';
    const ref = iRef >= 0 ? cells[iRef] : undefined;
    const date = iDate >= 0 ? cells[iDate] || '' : '';
    let amount = 0;
    let direction: MatchDirection = 'in';
    if (iAmount >= 0 && cells[iAmount]) {
      const n = parseFloat(cells[iAmount].replace(/\s/g, '').replace(',', '.'));
      amount = Math.abs(n);
      direction = n >= 0 ? 'in' : 'out';
    } else {
      const credit = iCredit >= 0 ? parseFloat(cells[iCredit] || '0') : 0;
      const debit = iDebit >= 0 ? parseFloat(cells[iDebit] || '0') : 0;
      if (credit > 0) {
        amount = credit;
        direction = 'in';
      } else if (debit > 0) {
        amount = debit;
        direction = 'out';
      }
    }
    if (!amount) continue;
    rows.push({
      id: `csv_${i}_${Date.now()}`,
      date,
      description: desc,
      reference: ref || undefined,
      amount,
      direction,
      matched: false,
    });
  }
  return rows;
}

function ofxTagValue(block: string, tag: string): string {
  // OFX 1.x often omits closing tags: <TRNAMT>-12.34
  const openClose = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m1 = block.match(openClose);
  if (m1) return m1[1].replace(/<[^>]+>/g, '').trim();
  const openOnly = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
  const m2 = block.match(openOnly);
  return m2 ? m2[1].trim() : '';
}

function ofxPostedDate(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Parse OFX 1.x (SGML) or OFX 2.x (XML) bank statement transactions. */
export function parseBankOfx(text: string): StatementLike[] {
  const src = String(text || '');
  if (!/<OFX[\s>]|<STMTTRN[\s>]/i.test(src)) return [];

  const blocks = [...src.matchAll(/<STMTTRN\b[^>]*>([\s\S]*?)<\/STMTTRN>/gi)];
  const rows: StatementLike[] = [];

  blocks.forEach((m, i) => {
    const block = m[1] || '';
    const amtRaw = ofxTagValue(block, 'TRNAMT').replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(amtRaw);
    if (!Number.isFinite(n) || n === 0) return;
    const description =
      ofxTagValue(block, 'NAME')
      || ofxTagValue(block, 'MEMO')
      || ofxTagValue(block, 'PAYEE')
      || 'OFX';
    const reference =
      ofxTagValue(block, 'FITID')
      || ofxTagValue(block, 'CHECKNUM')
      || undefined;
    rows.push({
      id: `ofx_${i}_${reference || Date.now()}`,
      date: ofxPostedDate(ofxTagValue(block, 'DTPOSTED')),
      description,
      reference: reference || undefined,
      amount: Math.abs(n),
      direction: n < 0 ? 'out' : 'in',
      matched: false,
    });
  });

  return rows;
}
