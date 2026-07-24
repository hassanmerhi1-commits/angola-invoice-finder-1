import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, FolderOpen, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  buildPosCategoryBuckets,
  filterPosProductsBySearch,
  getPosNavigableSearchResults,
} from '@/lib/posProductSearch';
import { measurePosGridColumns } from '@/lib/posGridNavigation';
import type { Category, Product } from '@/types/erp';

type PosCategoryBrowserProps = {
  products: Product[];
  categories: Category[];
  selectedCategory: string | null;
  searchTerm: string;
  highlightedProductId?: string | null;
  onSelectCategory: (name: string) => void;
  onBack: () => void;
  onProductSelect: (product: Product) => void;
  onGridColumnsChange?: (columns: number) => void;
};

function ProductTile({
  product,
  uiLocale,
  reservedLabel,
  highlighted,
  onSelect,
}: {
  product: Product;
  uiLocale: string;
  reservedLabel: string;
  highlighted?: boolean;
  onSelect: (product: Product) => void;
}) {
  const reserved = Number(product.reservedStock) || 0;
  return (
    <Card
      data-pos-product-id={product.id}
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        highlighted
          ? 'border-primary ring-2 ring-primary shadow-md'
          : 'hover:border-primary/50',
      )}
      onClick={() => onSelect(product)}
    >
      <CardContent className="p-4">
        <h4 className="font-medium text-sm leading-tight line-clamp-2 mb-1">
          {product.name}
        </h4>
        <p className="text-xs text-muted-foreground mb-2">{product.sku}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-bold text-primary">
            {product.price.toLocaleString(uiLocale)} Kz
          </span>
          <div className="text-right shrink-0">
            <Badge variant={product.stock > 10 ? 'secondary' : 'destructive'}>
              {product.stock} {product.unit}
            </Badge>
            {reserved > 0 && (
              <p className="text-[10px] text-amber-600 mt-0.5">
                {reservedLabel} {reserved}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PosCategoryBrowser({
  products,
  categories,
  selectedCategory,
  searchTerm,
  highlightedProductId,
  onSelectCategory,
  onBack,
  onProductSelect,
  onGridColumnsChange,
}: PosCategoryBrowserProps) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const reservedLabel = language === 'pt' ? 'reserv.' : 'rsvd';
  const scrollRef = useRef<HTMLDivElement>(null);

  const buckets = useMemo(
    () => buildPosCategoryBuckets(products, categories),
    [products, categories],
  );

  const searchResults = useMemo(
    () => getPosNavigableSearchResults(products, searchTerm, null, categories),
    [products, searchTerm, categories],
  );

  const isSearching = searchTerm.trim().length > 0;

  const activeBucket = selectedCategory
    ? buckets.find((b) => b.name === selectedCategory)
    : null;

  const categoryProducts = useMemo(() => {
    if (!activeBucket) return [];
    if (!isSearching) return activeBucket.products;
    return getPosNavigableSearchResults(products, searchTerm, selectedCategory, categories);
  }, [activeBucket, isSearching, searchTerm, selectedCategory, products, categories]);

  useEffect(() => {
    if (!highlightedProductId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-pos-product-id="${highlightedProductId}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [highlightedProductId, searchResults, categoryProducts]);

  useEffect(() => {
    if (!onGridColumnsChange || !scrollRef.current) return;

    const reportColumns = () => {
      onGridColumnsChange(measurePosGridColumns(scrollRef.current));
    };

    reportColumns();

    const gridEl = scrollRef.current;
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(reportColumns)
      : null;
    observer?.observe(gridEl);

    window.addEventListener('resize', reportColumns);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', reportColumns);
    };
  }, [onGridColumnsChange, searchResults.length, categoryProducts.length, selectedCategory, isSearching]);

  if (buckets.length === 0 && !isSearching) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[16rem] text-muted-foreground text-center px-4">
        <Package className="w-12 h-12 mb-2 opacity-40" />
        <p>{t.posUi.noProductsForBranch}</p>
      </div>
    );
  }

  if (isSearching && !selectedCategory) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <h2 className="font-semibold text-sm">{t.posUi.searchResultsTitle}</h2>
          <Badge variant="secondary">{searchResults.length}</Badge>
        </div>
        {searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground text-center px-4">
            <Package className="w-10 h-10 mb-2 opacity-40" />
            <p>{t.posUi.productNotFound}</p>
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
              {searchResults.map((product) => (
                <ProductTile
                  key={product.id}
                  product={product}
                  uiLocale={uiLocale}
                  reservedLabel={reservedLabel}
                  highlighted={product.id === highlightedProductId}
                  onSelect={onProductSelect}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (selectedCategory && activeBucket) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 mb-4 shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
            {t.posUi.backToCategories}
          </Button>
          <h2 className="font-semibold text-sm truncate">{activeBucket.name}</h2>
          <Badge variant="secondary" className="ml-auto shrink-0">
            {categoryProducts.length}
          </Badge>
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
          {categoryProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t.posUi.productNotFound}</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
              {categoryProducts.map((product) => (
                <ProductTile
                  key={product.id}
                  product={product}
                  uiLocale={uiLocale}
                  reservedLabel={reservedLabel}
                  highlighted={product.id === highlightedProductId}
                  onSelect={onProductSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto">
      <p className="text-xs text-muted-foreground mb-3">{t.posUi.pickCategoryHint}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
        {buckets.map((bucket) => (
          <Card
            key={bucket.name}
            className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
            onClick={() => onSelectCategory(bucket.name)}
          >
            <CardContent className="p-4 flex flex-col gap-3 min-h-[7rem]">
              <div className="flex items-start justify-between gap-2">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: bucket.color ? `${bucket.color}22` : undefined }}
                >
                  <FolderOpen
                    className="w-5 h-5"
                    style={{ color: bucket.color || 'var(--primary)' }}
                  />
                </div>
                <Badge variant="secondary">{bucket.products.length}</Badge>
              </div>
              <div>
                <h3 className="font-semibold text-sm leading-tight line-clamp-2">{bucket.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{t.posUi.tapToBrowse}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
