import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales, useProducts } from '@/hooks/useERP';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { Download, Printer, FileDown, Package } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { exportToExcel } from '@/lib/excel';
import { printHtml } from '@/lib/printHtml';
import { useTranslation } from '@/i18n';

interface ProductRow {
  code: string;
  name: string;
  stock: number;
  qty: number;
  price: number; // effective ex-VAT unit price = base / qty
  taxRate: number;
  base: number; // Total without VAT
  withVat: number; // Total with VAT
  cost: number;
  profit: number;
  marginPct: number;
}

interface CategoryGroup {
  name: string;
  rows: ProductRow[];
  totals: { qty: number; base: number; withVat: number; cost: number; profit: number };
}

interface Totals {
  qty: number;
  base: number;
  withVat: number;
  cost: number;
  profit: number;
}

const emptyTotals = (): Totals => ({ qty: 0, base: 0, withVat: 0, cost: 0, profit: 0 });

interface SalesByProductReportProps {
  /** When embedded inside another report (e.g. the Sales tab), date/branch filters are driven by the parent and the filter card is hidden. */
  embedded?: boolean;
  dateFrom?: string;
  dateTo?: string;
  selectedBranch?: string;
}

export default function SalesByProductReport(props: SalesByProductReportProps = {}) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const embedded = !!props.embedded;
  const { branches, currentBranch, apiBranchId, canPickBranch } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const { products } = useProducts(apiBranchId);
  const { companyName } = useCompanyLogo();

  const [dateFromState, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateToState, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [branchState, setSelectedBranch] = useState<string>('all');

  useEffect(() => {
    if (!embedded && !canPickBranch && currentBranch?.id) setSelectedBranch(currentBranch.id);
  }, [embedded, canPickBranch, currentBranch?.id]);

  // When embedded, the parent owns the filters.
  const dateFrom = embedded ? props.dateFrom ?? dateFromState : dateFromState;
  const dateTo = embedded ? props.dateTo ?? dateToState : dateToState;
  const selectedBranch = embedded ? props.selectedBranch ?? branchState : branchState;

  const productInfo = useMemo(() => {
    const m = new Map<string, { category: string; stock: number; cost: number; sku: string; name: string }>();
    products.forEach((p) => {
      m.set(p.id, {
        category: p.category || t.salesAnalysisUi.noCategory,
        stock: Number(p.stock || 0),
        cost: Number(p.avgCost || p.cost || 0),
        sku: p.sku || '',
        name: p.name || '',
      });
    });
    return m;
  }, [products, t.salesAnalysisUi.noCategory]);

  const { groups, grandTotal } = useMemo(() => {
    const inRange = (raw?: string) => {
      const d = raw ? String(raw).slice(0, 10) : '';
      return !!d && d >= dateFrom && d <= dateTo;
    };

    type Acc = {
      code: string;
      name: string;
      category: string;
      stock: number;
      cost: number;
      qty: number;
      base: number;
      vat: number;
      taxRate: number;
    };
    const byProduct: Record<string, Acc> = {};

    sales
      .filter(
        (s) =>
          s.status === 'completed' &&
          inRange(s.createdAt) &&
          (selectedBranch === 'all' || s.branchId === selectedBranch),
      )
      .forEach((s) => {
        s.items.forEach((item) => {
          const info = productInfo.get(item.productId);
          const key = item.productId || item.sku || item.productName;
          if (!byProduct[key]) {
            byProduct[key] = {
              code: info?.sku || item.sku || '',
              name: info?.name || item.productName || '',
              category: info?.category || t.salesAnalysisUi.noCategory,
              stock: info?.stock ?? 0,
              cost: info?.cost ?? 0,
              qty: 0,
              base: 0,
              vat: 0,
              taxRate: Number(item.taxRate || 0),
            };
          }
          const acc = byProduct[key];
          const qty = Number(item.quantity || 0);
          acc.qty += qty;
          acc.base += Number(item.subtotal || 0);
          acc.vat += Number(item.taxAmount || 0);
          if (item.taxRate) acc.taxRate = Number(item.taxRate);
        });
      });

    const groupMap: Record<string, ProductRow[]> = {};
    Object.values(byProduct).forEach((acc) => {
      const cost = acc.cost * acc.qty;
      const profit = acc.base - cost;
      const row: ProductRow = {
        code: acc.code,
        name: acc.name,
        stock: acc.stock,
        qty: acc.qty,
        price: acc.qty > 0 ? acc.base / acc.qty : 0,
        taxRate: acc.taxRate,
        base: acc.base,
        withVat: acc.base + acc.vat,
        cost,
        profit,
        marginPct: acc.base > 0 ? (profit / acc.base) * 100 : 0,
      };
      if (!groupMap[acc.category]) groupMap[acc.category] = [];
      groupMap[acc.category].push(row);
    });

    const grand = emptyTotals();
    const result: CategoryGroup[] = Object.entries(groupMap)
      .map(([name, rows]) => {
        rows.sort((a, b) => b.qty - a.qty);
        const totals = rows.reduce((acc, r) => {
          acc.qty += r.qty;
          acc.base += r.base;
          acc.withVat += r.withVat;
          acc.cost += r.cost;
          acc.profit += r.profit;
          return acc;
        }, emptyTotals());
        grand.qty += totals.qty;
        grand.base += totals.base;
        grand.withVat += totals.withVat;
        grand.cost += totals.cost;
        grand.profit += totals.profit;
        return { name, rows, totals };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { groups: result, grandTotal: grand };
  }, [sales, productInfo, dateFrom, dateTo, selectedBranch, t.salesAnalysisUi.noCategory]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

  const branchLabel =
    selectedBranch === 'all'
      ? t.salesByProductUi.allWarehouses
      : branches.find((b) => b.id === selectedBranch)?.name || currentBranch?.name || '';

  const handleExport = () => {
    const rows: Record<string, unknown>[] = [];
    groups.forEach((g) => {
      g.rows.forEach((r) => {
        rows.push({
          [t.salesByProductUi.category]: g.name,
          [t.salesByProductUi.code]: r.code,
          [t.salesByProductUi.product]: r.name,
          [t.salesByProductUi.stock]: r.stock,
          [t.salesByProductUi.qty]: r.qty,
          [t.salesByProductUi.price]: Number(r.price.toFixed(2)),
          [t.salesByProductUi.iva]: r.taxRate,
          [t.salesByProductUi.totalExVat]: Number(r.base.toFixed(2)),
          [t.salesByProductUi.totalIncVat]: Number(r.withVat.toFixed(2)),
          [t.salesByProductUi.profit]: Number(r.profit.toFixed(2)),
          [t.salesByProductUi.marginPct]: Number(r.marginPct.toFixed(2)),
          [t.salesByProductUi.cost]: Number(r.cost.toFixed(2)),
        });
      });
    });
    exportToExcel(rows, `Vendas_Produto_${dateFrom}_${dateTo}`);
  };

  const buildPrintHtml = () => {
    const head = `
      <div class="rpt-head">
        <h1>${companyName}</h1>
        <h2>${t.salesByProductUi.printTitle} — ${branchLabel}</h2>
        <p>${t.reportsUi.dateFrom}: ${dateFrom} &nbsp;&nbsp; ${t.reportsUi.dateTo}: ${dateTo}</p>
      </div>`;

    const colHeader = `
      <tr>
        <th class="l">${t.salesByProductUi.code}</th>
        <th class="l">${t.salesByProductUi.product}</th>
        <th class="r">${t.salesByProductUi.stock}</th>
        <th class="r">${t.salesByProductUi.qty}</th>
        <th class="r">${t.salesByProductUi.price}</th>
        <th class="c">${t.salesByProductUi.iva}</th>
        <th class="r">${t.salesByProductUi.totalExVat}</th>
        <th class="r">${t.salesByProductUi.totalIncVat}</th>
        <th class="r">${t.salesByProductUi.profit}</th>
        <th class="r">%</th>
        <th class="r">${t.salesByProductUi.cost}</th>
      </tr>`;

    const groupsHtml = groups
      .map((g) => {
        const body = g.rows
          .map(
            (r) => `
            <tr>
              <td class="mono">${r.code}</td>
              <td>${r.name}</td>
              <td class="r">${fmt(r.stock)}</td>
              <td class="r">${fmt(r.qty)}</td>
              <td class="r">${fmt(r.price)}</td>
              <td class="c">${r.taxRate}</td>
              <td class="r">${fmt(r.base)}</td>
              <td class="r">${fmt(r.withVat)}</td>
              <td class="r">${fmt(r.profit)}</td>
              <td class="r">${fmt(r.marginPct)}</td>
              <td class="r">${fmt(r.cost)}</td>
            </tr>`,
          )
          .join('');
        return `
          <div class="grp-title">${g.name}</div>
          <table>
            <thead>${colHeader}</thead>
            <tbody>${body}</tbody>
            <tfoot>
              <tr class="subtotal">
                <td colspan="3">${t.salesByProductUi.totalOf} ${g.name}</td>
                <td class="r">${fmt(g.totals.qty)}</td>
                <td></td><td></td>
                <td class="r">${fmt(g.totals.base)}</td>
                <td class="r">${fmt(g.totals.withVat)}</td>
                <td class="r">${fmt(g.totals.profit)}</td>
                <td></td>
                <td class="r">${fmt(g.totals.cost)}</td>
              </tr>
            </tfoot>
          </table>`;
      })
      .join('');

    const grand = `
      <table class="grand">
        <tr>
          <td colspan="3"><strong>${t.salesByProductUi.grandTotal}</strong></td>
          <td class="r"><strong>${fmt(grandTotal.qty)}</strong></td>
          <td></td><td></td>
          <td class="r"><strong>${fmt(grandTotal.base)}</strong></td>
          <td class="r"><strong>${fmt(grandTotal.withVat)}</strong></td>
          <td class="r"><strong>${fmt(grandTotal.profit)}</strong></td>
          <td></td>
          <td class="r"><strong>${fmt(grandTotal.cost)}</strong></td>
        </tr>
      </table>`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t.salesByProductUi.printTitle}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; padding: 16px; }
        .rpt-head { text-align: center; margin-bottom: 14px; }
        .rpt-head h1 { font-size: 15pt; margin: 0; }
        .rpt-head h2 { font-size: 11pt; margin: 4px 0; font-weight: normal; }
        .rpt-head p { font-size: 9pt; color: #444; margin: 0; }
        .grp-title { font-weight: bold; font-size: 10pt; margin: 14px 0 4px; border-bottom: 2px solid #000; padding-bottom: 2px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
        th, td { border: 1px solid #ccc; padding: 3px 5px; }
        th { background: #f0f0f0; font-size: 8pt; }
        .l { text-align: left; } .r { text-align: right; } .c { text-align: center; }
        .mono { font-family: 'Courier New', monospace; }
        .subtotal td { background: #f6f6f6; font-weight: bold; }
        table.grand td { border: none; border-top: 3px double #000; padding-top: 6px; font-size: 10pt; }
        @media print { body { padding: 0; } @page { size: A4 landscape; margin: 10mm; } }
      </style></head>
      <body>${head}${groupsHtml}${grand}</body></html>`;
  };

  const handlePrint = async () => {
    try {
      await printHtml(buildPrintHtml());
    } catch (e) {
      console.error('[SalesByProductReport] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    const html = buildPrintHtml();
    try {
      const el = typeof window !== 'undefined' ? (window as any).electronAPI : null;
      if (el?.isElectron && el?.pdf?.saveHtml) {
        await el.pdf.saveHtml(html, { filename: `vendas-produto_${dateFrom}_${dateTo}.pdf`, landscape: true });
        return;
      }
      await printHtml(html, { direct: true });
    } catch (e) {
      console.error('[SalesByProductReport] save pdf failed:', e);
    }
  };

  const actions = (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download className="w-4 h-4 mr-2" />
        {t.reportsUi.exportExcel}
      </Button>
      <Button variant="outline" size="sm" onClick={handlePrint}>
        <Printer className="w-4 h-4 mr-2" />
        {t.reportsUi.print}
      </Button>
      <Button variant="outline" size="sm" onClick={handleSavePdf}>
        <FileDown className="w-4 h-4 mr-2" />
        {t.reportsUi.savePdf}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex justify-end">{actions}</div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  {t.salesByProductUi.title}
                </CardTitle>
                <CardDescription>{t.salesByProductUi.description}</CardDescription>
              </div>
              {actions}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label>{t.reportsUi.dateFrom}</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label>{t.reportsUi.dateTo}</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div>
                <Label>{t.salesAnalysisUi.branch}</Label>
                <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={!canPickBranch}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {canPickBranch && <SelectItem value="all">{t.salesByProductUi.allWarehouses}</SelectItem>}
                    {(canPickBranch ? branches : currentBranch ? [currentBranch] : []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grand total summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesByProductUi.qty}</p>
            <p className="text-2xl font-bold">{fmt(grandTotal.qty)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesByProductUi.totalExVat}</p>
            <p className="text-2xl font-bold">{fmt(grandTotal.base)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesByProductUi.totalIncVat}</p>
            <p className="text-2xl font-bold">{fmt(grandTotal.withVat)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesByProductUi.cost}</p>
            <p className="text-2xl font-bold">{fmt(grandTotal.cost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesByProductUi.profit}</p>
            <p className={`text-2xl font-bold ${grandTotal.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {fmt(grandTotal.profit)}
            </p>
          </CardContent>
        </Card>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{t.common.noResults}</CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{g.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.salesByProductUi.code}</TableHead>
                      <TableHead>{t.salesByProductUi.product}</TableHead>
                      <TableHead className="text-right">{t.salesByProductUi.stock}</TableHead>
                      <TableHead className="text-right">{t.salesByProductUi.qty}</TableHead>
                      <TableHead className="text-right">{t.salesByProductUi.price}</TableHead>
                      <TableHead className="text-center">{t.salesByProductUi.iva}</TableHead>
                      <TableHead className="text-right">{t.salesByProductUi.totalExVat}</TableHead>
                      <TableHead className="text-right">{t.salesByProductUi.totalIncVat}</TableHead>
                      <TableHead className="text-right">{t.salesByProductUi.profit}</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead className="text-right">{t.salesByProductUi.cost}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rows.map((r) => (
                      <TableRow key={r.code + r.name}>
                        <TableCell className="font-mono text-xs">{r.code}</TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-right">{fmt(r.stock)}</TableCell>
                        <TableCell className="text-right">{fmt(r.qty)}</TableCell>
                        <TableCell className="text-right">{fmt(r.price)}</TableCell>
                        <TableCell className="text-center">{r.taxRate}%</TableCell>
                        <TableCell className="text-right">{fmt(r.base)}</TableCell>
                        <TableCell className="text-right">{fmt(r.withVat)}</TableCell>
                        <TableCell className={`text-right ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt(r.profit)}
                        </TableCell>
                        <TableCell className={`text-right ${r.marginPct >= 10 ? 'text-green-600' : 'text-orange-600'}`}>
                          {fmt(r.marginPct)}
                        </TableCell>
                        <TableCell className="text-right">{fmt(r.cost)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={3}>
                        {t.salesByProductUi.totalOf} {g.name}
                      </TableCell>
                      <TableCell className="text-right">{fmt(g.totals.qty)}</TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-right">{fmt(g.totals.base)}</TableCell>
                      <TableCell className="text-right">{fmt(g.totals.withVat)}</TableCell>
                      <TableCell className="text-right">{fmt(g.totals.profit)}</TableCell>
                      <TableCell />
                      <TableCell className="text-right">{fmt(g.totals.cost)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
