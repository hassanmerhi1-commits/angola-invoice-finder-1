import * as XLSX from 'xlsx';
import type { IncomeStatementLine } from '@/lib/reports/incomeStatement';

export type IncomeStatementExcelMeta = {
  companyName?: string;
  title: string;
  periodLabel: string;
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
  sheetName?: string;
  labelCompany?: string;
  labelPeriod?: string;
  labelBranch?: string;
  labelGenerated?: string;
};

function setNumber(cell: XLSX.CellObject | undefined, format = '#,##0.00;(#,##0.00);"—"') {
  if (cell && typeof cell.v === 'number') cell.z = format;
}

function setPercent(cell: XLSX.CellObject | undefined) {
  if (cell && typeof cell.v === 'number') cell.z = '0.0%;(0.0%);"—"';
}

export function buildIncomeStatementWorkbook(opts: {
  lines: IncomeStatementLine[];
  previousByKey?: Map<string, number>;
  meta: IncomeStatementExcelMeta;
}): XLSX.WorkBook {
  const { lines, previousByKey, meta } = opts;
  const hasPrev = !!previousByKey && !!meta.colPrevious;
  const lastCol = hasPrev ? 5 : 2;

  const headers = hasPrev
    ? [
        meta.colCode,
        meta.colDescription,
        meta.colPrevious,
        meta.colValue,
        meta.colVariance || '',
        meta.colVariancePct || '',
      ]
    : [meta.colCode, meta.colDescription, meta.colValue];

  const aoa: Array<Array<string | number | null>> = [];
  const pushMeta = (label: string | undefined, value: string | undefined) => {
    if (!value) return;
    aoa.push([label || '', value, ...Array(Math.max(0, lastCol - 1)).fill(null)]);
  };

  aoa.push([meta.title, ...Array(lastCol).fill(null)]);
  aoa.push(Array(lastCol + 1).fill(null));
  pushMeta(meta.labelCompany, meta.companyName);
  pushMeta(meta.labelPeriod, meta.periodLabel);
  pushMeta(meta.labelBranch, meta.branchLabel);
  pushMeta(undefined, meta.valuesInKz);
  pushMeta(meta.labelGenerated, meta.generatedAt);
  aoa.push(Array(lastCol + 1).fill(null));
  const headerRow = aoa.length;
  aoa.push(headers);

  for (const line of lines) {
    const key = `${line.description}|${line.code}`;
    const prev = previousByKey?.get(key) ?? 0;
    const variance = line.value - prev;
    const pct = Math.abs(prev) < 0.005 ? null : variance / Math.abs(prev);

    if (line.isHeader) {
      aoa.push(hasPrev
        ? [null, line.description, null, null, null, null]
        : [null, line.description, null]);
      continue;
    }
    if (hasPrev) {
      aoa.push([
        line.code || null,
        line.description,
        prev,
        line.value,
        variance,
        pct,
      ]);
    } else {
      aoa.push([line.code || null, line.description, line.value]);
    }
  }

  if (meta.sourceNote) {
    aoa.push(Array(lastCol + 1).fill(null));
    aoa.push([meta.sourceNote, ...Array(lastCol).fill(null)]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
  ];
  if (meta.sourceNote) {
    const lastRow = aoa.length - 1;
    ws['!merges'].push({ s: { r: lastRow, c: 0 }, e: { r: lastRow, c: lastCol } });
  }

  ws['!cols'] = hasPrev
    ? [{ wch: 10 }, { wch: 44 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }]
    : [{ wch: 10 }, { wch: 48 }, { wch: 18 }];

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const first = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const second = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    const isNote = typeof first?.v === 'string' && String(first.v).length > 40 && !second?.v;
    if (isNote) continue;
    if (hasPrev) {
      setNumber(ws[XLSX.utils.encode_cell({ r, c: 2 })]);
      setNumber(ws[XLSX.utils.encode_cell({ r, c: 3 })]);
      setNumber(ws[XLSX.utils.encode_cell({ r, c: 4 })]);
      setPercent(ws[XLSX.utils.encode_cell({ r, c: 5 })]);
    } else {
      setNumber(ws[XLSX.utils.encode_cell({ r, c: 2 })]);
    }
  }

  const freezeAt = headerRow + 1;
  ws['!views'] = [{
    state: 'frozen',
    ySplit: freezeAt,
    topLeftCell: `A${freezeAt + 1}`,
    activePane: 'bottomLeft',
  }];
  ws['!margins'] = { left: 0.45, right: 0.45, top: 0.55, bottom: 0.45, header: 0.2, footer: 0.2 };
  ws['!pageSetup'] = {
    paperSize: 9,
    orientation: 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (meta.sheetName || 'Resultados').slice(0, 31));
  return wb;
}

export function downloadIncomeStatementExcel(opts: {
  lines: IncomeStatementLine[];
  previousByKey?: Map<string, number>;
  meta: IncomeStatementExcelMeta;
  filename: string;
}): void {
  const wb = buildIncomeStatementWorkbook(opts);
  const name = opts.filename.endsWith('.xlsx') ? opts.filename : `${opts.filename}.xlsx`;
  XLSX.writeFile(wb, name, { bookType: 'xlsx' });
}
