import { format } from 'date-fns';
import { Product } from '@/types/erp';
import { readProductStock } from '@/lib/inventoryGrid';
import { escapeHtml } from '@/lib/reportExport';

/** Warehouse count sheet always follows the Portuguese A4 template. */
export const COUNT_SHEET_TEMPLATE = {
  reportTitle: 'Qtd por Armazém',
  companyLabel: 'Empresa',
  branchLabel: 'Filial',
  asOfLabel: 'A Data',
  countedByLabel: 'Contado por',
  colCode: 'Código',
  colDescription: 'Descrição',
  colQty: 'Qtd',
  colCount: 'Contagem',
  colDiff: 'Diff',
  filePrefix: 'Qtd_por_Armazem',
} as const;

export type CountSheetRow = {
  sku: string;
  name: string;
  qty: number | null;
};

export type CountSheetHeader = {
  companyName?: string;
  branchName?: string;
  branchCode?: string;
  countedBy?: string;
  date?: Date;
};

export type CountSheetPrintedHeader = {
  title: string;
  company: string;
  branch: string;
  asOf: string;
  countedBy: string;
};

export function formatCountSheetQty(qty: number): string {
  return qty.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildCountSheetRows(
  products: Product[],
  hideSystemStock: boolean,
): CountSheetRow[] {
  return products.map((product) => ({
    sku: String(product.sku || '').trim(),
    name: String(product.name || '').trim().toUpperCase(),
    qty: hideSystemStock ? null : readProductStock(product),
  }));
}

function sheetDate(date = new Date()): string {
  return format(date, 'dd/MM/yyyy');
}

function branchLine(header: CountSheetHeader): string {
  const name = String(header.branchName || '').trim();
  const code = String(header.branchCode || '').trim();
  if (name && code) return `${name} (${code})`;
  return name || code || '—';
}

function labeled(label: string, value: string): string {
  return `${label}: ${value}`;
}

export function buildCountSheetPrintedHeader(header: CountSheetHeader): CountSheetPrintedHeader {
  return {
    title: COUNT_SHEET_TEMPLATE.reportTitle,
    company: labeled(COUNT_SHEET_TEMPLATE.companyLabel, header.companyName?.trim() || '—'),
    branch: labeled(COUNT_SHEET_TEMPLATE.branchLabel, branchLine(header)),
    asOf: labeled(COUNT_SHEET_TEMPLATE.asOfLabel, sheetDate(header.date)),
    countedBy: labeled(COUNT_SHEET_TEMPLATE.countedByLabel, header.countedBy?.trim() || ''),
  };
}

export function countSheetMetaLines(header: CountSheetHeader): string[] {
  const printed = buildCountSheetPrintedHeader(header);
  return [printed.company, printed.branch, printed.asOf, printed.countedBy];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countSheetFileName(header: CountSheetHeader): string {
  const code = String(header.branchCode || 'geral').replace(/[^\w-]+/g, '');
  return `${COUNT_SHEET_TEMPLATE.filePrefix}_${code}_${format(header.date || new Date(), 'yyyy-MM-dd')}.xls`;
}

export function buildCountSheetHtml(opts: {
  rows: CountSheetRow[];
  header: CountSheetHeader;
}): string {
  const printed = buildCountSheetPrintedHeader(opts.header);
  const body = opts.rows.map((row) => `
    <tr>
      <td class="code">${escapeHtml(row.sku)}</td>
      <td class="name">${escapeHtml(row.name)}</td>
      <td class="num">${row.qty == null ? '' : escapeHtml(formatCountSheetQty(row.qty))}</td>
      <td class="write"></td>
      <td class="write"></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(printed.title)}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4 portrait; margin: 7mm; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111;
      width: 196mm;
    }
    .page-head { margin: 0 0 3.5mm; }
    .page-head .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8mm;
    }
    .page-head h1 {
      margin: 0;
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.15;
    }
    .page-head .meta {
      margin: 0.6mm 0 0;
      font-size: 7.5pt;
      line-height: 1.25;
    }
    .page-head .meta.right { text-align: right; white-space: nowrap; }
    table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.grid th, table.grid td {
      border: 0.35pt solid #7f8c9b;
      padding: 0.7mm 1mm;
      font-size: 7pt;
      line-height: 1.1;
    }
    table.grid th { background: #d6e3f0; font-weight: 700; text-align: left; }
    table.grid .code { width: 18mm; }
    table.grid .name { width: auto; }
    table.grid .num, table.grid .write { width: 16mm; text-align: right; }
    table.grid .write { background: #fffdf4; }
    @media print { body { width: auto; } }
  </style>
</head>
<body>
  <header class="page-head">
    <div class="row">
      <h1>${escapeHtml(printed.title)}</h1>
      <p class="meta right">${escapeHtml(printed.asOf)}</p>
    </div>
    <div class="row">
      <p class="meta">${escapeHtml(printed.company)}</p>
      <p class="meta right">${escapeHtml(printed.countedBy)}</p>
    </div>
    <p class="meta">${escapeHtml(printed.branch)}</p>
  </header>
  <table class="grid">
    <thead>
      <tr>
        <th class="code">${COUNT_SHEET_TEMPLATE.colCode}</th>
        <th class="name">${COUNT_SHEET_TEMPLATE.colDescription}</th>
        <th class="num">${COUNT_SHEET_TEMPLATE.colQty}</th>
        <th class="write">${COUNT_SHEET_TEMPLATE.colCount}</th>
        <th class="write">${COUNT_SHEET_TEMPLATE.colDiff}</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

function excelBorder(): string {
  return `
    <Borders>
      <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#7F8C9B"/>
      <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#7F8C9B"/>
      <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#7F8C9B"/>
      <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#7F8C9B"/>
    </Borders>`;
}

function excelStringCell(style: string, value: string, mergeAcross = 0): string {
  const merge = mergeAcross > 0 ? ` ss:MergeAcross="${mergeAcross}"` : '';
  return `<Cell${merge} ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function excelNumberCell(style: string, value: number): string {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${value}</Data></Cell>`;
}

function excelEmptyCell(style: string): string {
  return `<Cell ss:StyleID="${style}"/>`;
}

export function buildCountSheetExcelXml(
  rows: CountSheetRow[],
  header: CountSheetHeader,
): string {
  const printed = buildCountSheetPrintedHeader(header);
  const lastRow = 5 + rows.length;
  const dataRows = rows.map((row) => {
    const qtyCell = row.qty == null
      ? excelEmptyCell('CellNum')
      : excelNumberCell('CellNum', Number(row.qty));
    return `<Row ss:Height="12.5">${
      excelStringCell('Cell', row.sku)
    }${
      excelStringCell('Cell', row.name)
    }${qtyCell}${excelEmptyCell('Write')}${excelEmptyCell('Write')}</Row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>${escapeXml(printed.title)}</Title>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:FontName="Arial" ss:Size="8"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Title">
   <Font ss:FontName="Arial" ss:Size="12" ss:Bold="1"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Meta">
   <Font ss:FontName="Arial" ss:Size="8"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="MetaRight">
   <Font ss:FontName="Arial" ss:Size="8"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Head">
   <Font ss:FontName="Arial" ss:Size="8" ss:Bold="1"/>
   <Interior ss:Color="#D6E3F0" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   ${excelBorder()}
  </Style>
  <Style ss:ID="HeadNum">
   <Font ss:FontName="Arial" ss:Size="8" ss:Bold="1"/>
   <Interior ss:Color="#D6E3F0" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   ${excelBorder()}
  </Style>
  <Style ss:ID="Cell">
   <Font ss:FontName="Arial" ss:Size="8"/>
   <Alignment ss:Vertical="Center"/>
   ${excelBorder()}
  </Style>
  <Style ss:ID="CellNum">
   <Font ss:FontName="Arial" ss:Size="8"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   ${excelBorder()}
  </Style>
  <Style ss:ID="Write">
   <Font ss:FontName="Arial" ss:Size="8"/>
   <Interior ss:Color="#FFFDF4" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   ${excelBorder()}
  </Style>
 </Styles>
 <Worksheet ss:Name="Qtd por Armazem">
  <Names>
   <NamedRange ss:Name="Print_Area" ss:RefersTo="='Qtd por Armazem'!R1C1:R${lastRow}C5"/>
  </Names>
  <Table ss:ExpandedColumnCount="5" ss:ExpandedRowCount="${lastRow}" ss:DefaultRowHeight="12.5">
   <Column ss:Index="1" ss:AutoFitWidth="0" ss:Width="62"/>
   <Column ss:Index="2" ss:AutoFitWidth="0" ss:Width="210"/>
   <Column ss:Index="3" ss:AutoFitWidth="0" ss:Width="46"/>
   <Column ss:Index="4" ss:AutoFitWidth="0" ss:Width="54"/>
   <Column ss:Index="5" ss:AutoFitWidth="0" ss:Width="44"/>
   <Row ss:Height="16">
    ${excelStringCell('Title', printed.title, 2)}
    ${excelStringCell('MetaRight', printed.asOf, 1)}
   </Row>
   <Row ss:Height="13">
    ${excelStringCell('Meta', printed.company, 2)}
    ${excelStringCell('MetaRight', printed.countedBy, 1)}
   </Row>
   <Row ss:Height="13">
    ${excelStringCell('Meta', printed.branch, 4)}
   </Row>
   <Row ss:Height="6"/>
   <Row ss:Height="14">
    ${excelStringCell('Head', COUNT_SHEET_TEMPLATE.colCode)}
    ${excelStringCell('Head', COUNT_SHEET_TEMPLATE.colDescription)}
    ${excelStringCell('HeadNum', COUNT_SHEET_TEMPLATE.colQty)}
    ${excelStringCell('HeadNum', COUNT_SHEET_TEMPLATE.colCount)}
    ${excelStringCell('HeadNum', COUNT_SHEET_TEMPLATE.colDiff)}
   </Row>
   ${dataRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <PageSetup>
    <Layout x:Orientation="Portrait"/>
    <Header x:Margin="0.12"/>
    <Footer x:Margin="0.12"/>
    <PageMargins x:Bottom="0.28" x:Left="0.25" x:Right="0.25" x:Top="0.28"/>
   </PageSetup>
   <FitToPage/>
   <Print>
    <ValidPrinterInfo/>
    <PaperSizeIndex>9</PaperSizeIndex>
    <FitWidth>1</FitWidth>
    <FitHeight>0</FitHeight>
   </Print>
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>5</SplitHorizontal>
   <TopRowBottomPane>5</TopRowBottomPane>
   <ActivePane>2</ActivePane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

export function downloadCountSheetExcel(
  rows: CountSheetRow[],
  header: CountSheetHeader,
): void {
  const xml = buildCountSheetExcelXml(rows, header);
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = countSheetFileName(header);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
