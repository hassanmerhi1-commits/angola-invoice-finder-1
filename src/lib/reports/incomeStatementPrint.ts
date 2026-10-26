import { buildReportHtml, escapeHtml } from '@/lib/reportExport';
import type { IncomeStatementLine } from '@/lib/reports/incomeStatement';

export type IncomeStatementPrintMeta = {
  title: string;
  subtitle?: string;
  companyName?: string;
  periodLabel?: string;
  branchLabel?: string;
  generatedAt?: string;
  valuesInKz: string;
  sourceNote?: string;
  colCode: string;
  colDescription: string;
  colValue: string;
  colPrevious?: string;
  colVariance?: string;
  colVariancePct?: string;
};

function money(value: number, locale: string): string {
  const formatted = Math.abs(value).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${formatted})` : formatted;
}

function pct(current: number, previous: number, locale: string): string {
  if (Math.abs(previous) < 0.005) return '—';
  const value = (current - previous) / Math.abs(previous);
  return value.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function buildIncomeStatementPrintHtml(opts: {
  lines: IncomeStatementLine[];
  previousByKey?: Map<string, number>;
  meta: IncomeStatementPrintMeta;
  locale: string;
}): string {
  const { lines, previousByKey, meta, locale } = opts;
  const hasPrev = !!previousByKey && !!meta.colPrevious;

  const head = `
    <tr>
      <th class="c-code">${escapeHtml(meta.colCode)}</th>
      <th>${escapeHtml(meta.colDescription)}</th>
      ${hasPrev ? `<th class="r">${escapeHtml(meta.colPrevious || '')}</th>` : ''}
      <th class="r">${escapeHtml(meta.colValue)}</th>
      ${hasPrev ? `<th class="r">${escapeHtml(meta.colVariance || '')}</th>` : ''}
      ${hasPrev ? `<th class="r">${escapeHtml(meta.colVariancePct || '')}</th>` : ''}
    </tr>`;

  const body = lines.map((line) => {
    const key = `${line.description}|${line.code}`;
    const prev = previousByKey?.get(key) ?? 0;
    const cls = line.isTotal ? 'tot' : line.isSubtotal ? 'sub' : line.isHeader ? 'sec' : 'row';
    const indent = line.indent ? ` class="ind"` : '';
    if (line.isHeader) {
      const span = hasPrev ? 6 : 3;
      return `<tr class="sec"><td colspan="${span}">${escapeHtml(line.description)}</td></tr>`;
    }
    const variance = line.value - prev;
    return `<tr class="${cls}">
      <td class="c-code">${escapeHtml(line.code || '')}</td>
      <td${indent}>${escapeHtml(line.description)}</td>
      ${hasPrev ? `<td class="r muted">${escapeHtml(money(prev, locale))}</td>` : ''}
      <td class="r">${escapeHtml(money(line.value, locale))}</td>
      ${hasPrev ? `<td class="r">${escapeHtml(money(variance, locale))}</td>` : ''}
      ${hasPrev ? `<td class="r muted">${escapeHtml(pct(line.value, prev, locale))}</td>` : ''}
    </tr>`;
  }).join('');

  const extra = [
    meta.valuesInKz,
    meta.sourceNote,
  ].filter(Boolean).map((text) => `<p class="stmt-note">${escapeHtml(text as string)}</p>`).join('');

  return buildReportHtml({
    title: meta.title,
    subtitle: meta.subtitle,
    companyName: meta.companyName,
    periodLabel: meta.periodLabel,
    branchLabel: meta.branchLabel,
    generatedAt: meta.generatedAt,
    bodyHtml: `
      <style>
        table.stmt { border: none; }
        table.stmt th, table.stmt td { border: none; padding: 4px 6px; }
        table.stmt thead th {
          border-bottom: 2px solid #111;
          font-size: 8pt;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          background: transparent;
        }
        table.stmt td.ind { padding-left: 22px; }
        table.stmt td.c-code { width: 52px; color: #666; font-family: Consolas, monospace; font-size: 8pt; }
        table.stmt tr.sec td {
          background: #1e2937;
          color: #fff;
          font-weight: 700;
          font-size: 8pt;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 6px;
        }
        table.stmt tr.sub td { border-top: 1px solid #bbb; font-weight: 700; background: #f6f7f8; }
        table.stmt tr.tot td {
          border-top: 2px solid #111;
          border-bottom: 4px double #111;
          font-weight: 700;
        }
        table.stmt tr.row td { border-bottom: 1px solid #eee; }
        .stmt-note { margin-top: 10px; font-size: 8pt; color: #555; }
      </style>
      <table class="stmt">
        <thead>${head}</thead>
        <tbody>${body}</tbody>
      </table>
      ${extra}
    `,
  });
}
