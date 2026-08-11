import { useEffect, useMemo, useRef } from 'react';
import { Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { filterPosProductsBySearch } from '@/lib/posProductSearch';
import type { Product } from '@/types/erp';

type PosProductSearchListProps = {
  products: Product[];
  searchTerm: string;
  highlightedProductId?: string | null;
  onProductSelect: (product: Product) => void;
};

export function PosProductSearchList({
  products,
  searchTerm,
  highlightedProductId,
  onProductSelect,
}: PosProductSearchListProps) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const scrollRef = useRef<HTMLDivElement>(null);

  const searchResults = useMemo(
    () => filterPosProductsBySearch(products, searchTerm),
    [products, searchTerm],
  );

  useEffect(() => {
    if (!highlightedProductId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-pos-product-id="${highlightedProductId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightedProductId, searchResults]);

  if (!searchTerm.trim()) return null;

  return (
    <div className="flex flex-col min-h-0 border-b bg-muted/20">
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b bg-card/80">
        <h2 className="font-semibold text-xs">{t.posUi.searchResultsTitle}</h2>
        <Badge variant="secondary" className="text-[10px]">{searchResults.length}</Badge>
      </div>
      {searchResults.length === 0 ? (
        <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm py-6 px-4">
          <Package className="w-5 h-5 opacity-40 shrink-0" />
          <p>{t.posUi.productNotFound}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="max-h-[28vh] overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-card border-b">
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-semibold">{t.inventoryGridUi.name}</th>
                <th className="px-3 py-1.5 text-left font-semibold w-24">{t.inventoryGridUi.sku}</th>
                <th className="px-3 py-1.5 text-right font-semibold w-28">{t.inventoryGridUi.priceNoTax}</th>
                <th className="px-3 py-1.5 text-center font-semibold w-20">{t.common.quantity}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {searchResults.map((product) => {
                const highlighted = product.id === highlightedProductId;
                const priceIncVat = Number(
                  (product.price * (1 + (product.taxRate || 0) / 100)).toFixed(2),
                );
                return (
                  <tr
                    key={product.id}
                    data-pos-product-id={product.id}
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-accent/50',
                      highlighted && 'bg-primary/10',
                    )}
                    onClick={() => onProductSelect(product)}
                  >
                    <td className="px-3 py-2 font-medium leading-tight">{product.name}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{product.sku}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                      {product.price.toLocaleString(uiLocale)} Kz
                      <span className="block text-[10px] text-muted-foreground font-sans">
                        {priceIncVat.toLocaleString(uiLocale)} {t.inventoryGridUi.priceWithTax}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant={product.stock > 10 ? 'secondary' : 'destructive'} className="text-[10px]">
                        {product.stock} {product.unit}
                      </Badge>
                      {(Number(product.reservedStock) || 0) > 0 && (
                        <span className="block text-[10px] text-amber-600 mt-0.5">
                          {language === 'pt' ? 'reserv.' : 'rsvd'} {product.reservedStock}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
