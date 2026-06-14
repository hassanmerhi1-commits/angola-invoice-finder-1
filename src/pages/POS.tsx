import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCart, useSales, useAuth } from '@/hooks/useERP';
import { printPosThermalReceipts } from '@/lib/thermalPrinter';
import { recordSalePrint } from '@/lib/recordPrintAudit';
import { usePosProducts } from '@/hooks/usePosProducts';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useKeyboardShortcuts, KeyboardShortcut } from '@/hooks/useKeyboardShortcuts';
import { Sale, Product } from '@/types/erp';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PosCategoryBrowser } from '@/components/pos/PosCategoryBrowser';
import { findPosProductByCode, getPosNavigableSearchResults } from '@/lib/posProductSearch';
import { movePosGridIndex } from '@/lib/posGridNavigation';
import { useCategories } from '@/hooks/useERP';
import { Cart } from '@/components/pos/Cart';
import { CheckoutDialog } from '@/components/pos/CheckoutDialog';
import { ReceiptDialog } from '@/components/pos/ReceiptDialog';
import { BranchSelector } from '@/components/BranchSelector';
import { Search, ScanBarcode, Keyboard, ShoppingCart, FileText } from 'lucide-react';
import { PosEndOfDayReportDialog } from '@/components/pos/PosEndOfDayReportDialog';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { readNexorPosNewSaleFlag, NEXOR_POS_NEW_SALE_NAV_STATE } from '@/lib/nexorPosNewSale';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';

export default function POS() {
  const location = useLocation();
  const navigate = useNavigate();
  const { products = [], loading: productsLoading, refreshProducts, applySoldQuantities, currentBranch, branchId } = usePosProducts();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { categories } = useCategories();
  const cart = useCart();
  const { completeSale, sales, refreshSales } = useSales(currentBranch?.id);

  const [searchTerm, setSearchTerm] = useState('');
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(-1);
  const [searchGridColumns, setSearchGridColumns] = useState(2);
  const [selectedCartProductId, setSelectedCartProductId] = useState<string | null>(null);
  const [focusCartQtyProductId, setFocusCartQtyProductId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [endOfDayOpen, setEndOfDayOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const navigableSearchResults = useMemo(
    () => getPosNavigableSearchResults(products, searchTerm, selectedCategory, categories),
    [products, searchTerm, selectedCategory, categories],
  );

  const highlightedProductId = navigableSearchResults[searchHighlightIndex]?.id ?? null;

  useEffect(() => {
    if (!searchTerm.trim() || navigableSearchResults.length === 0) {
      setSearchHighlightIndex(-1);
      return;
    }
    setSearchHighlightIndex(0);
  }, [searchTerm, navigableSearchResults.length]);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setSearchHighlightIndex(-1);
  }, []);

  const addProductToCart = useCallback(
    (product: Product) => {
      cart.addItem(product);
      setSelectedCartProductId(product.id);
      setFocusCartQtyProductId(product.id);
      toast.success(t.posUi.itemAdded.replace('{name}', product.name));
    },
    [cart, t.posUi],
  );

  const handleSearchSubmit = useCallback(() => {
    const term = searchTerm.trim();
    const product = (searchHighlightIndex >= 0 ? navigableSearchResults[searchHighlightIndex] : null)
      ?? (term ? findPosProductByCode(products, term) : null)
      ?? (navigableSearchResults[0] ?? null);

    if (!product) {
      if (term) {
        toast.error(t.posUi.productNotFound, {
          description: `${t.posUi.code}: ${term}`,
        });
      }
      return;
    }

    addProductToCart(product);
    clearSearch();
  }, [products, searchTerm, navigableSearchResults, searchHighlightIndex, addProductToCart, clearSearch, t.posUi]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearchSubmit();
        return;
      }
      if (navigableSearchResults.length === 0) return;

      if (
        e.key === 'ArrowDown'
        || e.key === 'ArrowUp'
        || e.key === 'ArrowLeft'
        || e.key === 'ArrowRight'
      ) {
        e.preventDefault();
        const prev = searchHighlightIndex;
        const next = movePosGridIndex(
          prev < 0 ? 0 : prev,
          e.key,
          navigableSearchResults.length,
          searchGridColumns,
        );
        setSearchHighlightIndex(next);
      }
    },
    [handleSearchSubmit, navigableSearchResults, searchGridColumns, searchHighlightIndex],
  );

  const handleSelectCartLine = useCallback((productId: string) => {
    setSelectedCartProductId(productId);
    setFocusCartQtyProductId(productId);
  }, []);

  // Handle barcode scan
  const handleBarcodeScan = useCallback(
    (barcode: string) => {
      const product = findPosProductByCode(products, barcode);
      if (product) {
        cart.addItem(product);
        setSelectedCartProductId(product.id);
        setFocusCartQtyProductId(product.id);
        setLastScannedBarcode(barcode);
        toast.success(t.posUi.itemAdded.replace('{name}', product.name), {
          description: `${t.posUi.code}: ${barcode}`,
        });
        setTimeout(() => setLastScannedBarcode(null), 2000);
      } else {
        toast.error(t.posUi.productNotFound, {
          description: `${t.posUi.code}: ${barcode}`,
        });
      }
    },
    [products, cart, t.posUi],
  );

  useBarcodeScanner({ onScan: handleBarcodeScan });

  const handleCheckout = useCallback(() => {
    if (cart.items.length > 0) {
      setCheckoutOpen(true);
    } else {
      toast.info(t.posUi.emptyCart, { description: t.posUi.addProductsToCheckout });
    }
  }, [cart.items.length, t.posUi]);

  const handleClearCart = useCallback(() => {
    if (cart.items.length > 0) {
      cart.clearCart();
      toast.info(t.posUi.cartCleared);
    }
  }, [cart, t.posUi]);

  /** Same as receipt “Nova venda”: cart + checkout + receipt + last sale (TopNav / deep links). */
  const beginNewSaleSession = useCallback(() => {
    cart.clearCart();
    setCheckoutOpen(false);
    setReceiptOpen(false);
    setLastSale(null);
    setSearchTerm('');
    setSearchHighlightIndex(-1);
    setSelectedCartProductId(null);
    setFocusCartQtyProductId(null);
    setSelectedCategory(null);
  }, [cart]);

  useEffect(() => {
    if (!readNexorPosNewSaleFlag(location.state)) return;
    beginNewSaleSession();
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: {} },
    );
  }, [location.state, location.pathname, location.search, location.hash, navigate, beginNewSaleSession]);

  useEffect(() => {
    const onToolbarNewSale = () => beginNewSaleSession();
    const onCheckout = () => handleCheckout();
    const onVoid = () => handleClearCart();
    window.addEventListener('nexor:pos-new-sale', onToolbarNewSale);
    window.addEventListener(NEXOR_TOOLBAR.POS_CHECKOUT, onCheckout);
    window.addEventListener(NEXOR_TOOLBAR.POS_VOID, onVoid);
    return () => {
      window.removeEventListener('nexor:pos-new-sale', onToolbarNewSale);
      window.removeEventListener(NEXOR_TOOLBAR.POS_CHECKOUT, onCheckout);
      window.removeEventListener(NEXOR_TOOLBAR.POS_VOID, onVoid);
    };
  }, [beginNewSaleSession, handleCheckout, handleClearCart]);

  const handleBackToCategories = useCallback(() => {
    setSelectedCategory(null);
  }, []);

  const handleEscape = useCallback(() => {
    if (selectedCategory) {
      handleBackToCategories();
      return;
    }
    handleClearCart();
  }, [selectedCategory, handleBackToCategories, handleClearCart]);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  // Keyboard shortcuts
  const shortcuts: KeyboardShortcut[] = useMemo(
    () => [
      {
        key: 'F12',
        action: handleCheckout,
        description: t.posUi.checkoutShortcut,
      },
      {
        key: 'Escape',
        action: handleEscape,
        description: t.posUi.escapeShortcut,
      },
      {
        key: 'F2',
        action: focusSearch,
        description: t.posUi.searchProductShortcut,
      },
      {
        key: '+',
        action: () => {
          if (cart.items.length > 0) {
            const lastItem = cart.items[cart.items.length - 1];
            cart.updateQuantity(lastItem.product.id, lastItem.quantity + 1);
          }
        },
        description: t.posUi.increaseLastItem,
      },
      {
        key: '-',
        action: () => {
          if (cart.items.length > 0) {
            const lastItem = cart.items[cart.items.length - 1];
            if (lastItem.quantity > 1) {
              cart.updateQuantity(lastItem.product.id, lastItem.quantity - 1);
            }
          }
        },
        description: t.posUi.decreaseLastItem,
      },
      {
        key: 'Delete',
        action: () => {
          if (cart.items.length > 0) {
            const lastItem = cart.items[cart.items.length - 1];
            cart.removeItem(lastItem.product.id);
            toast.info(t.posUi.itemRemoved.replace('{name}', lastItem.product.name));
          }
        },
        description: t.posUi.removeLastItem,
      },
    ],
    [handleCheckout, handleEscape, focusSearch, cart, t.posUi]
  );

  useKeyboardShortcuts({ shortcuts, enabled: !checkoutOpen && !receiptOpen });

  const handleCompleteSale = async (
    paymentMethod: Sale['paymentMethod'],
    amountPaid: number,
    customerNif?: string,
    customerName?: string,
  ) => {
    if (!currentBranch || !user) return;

    try {
      const soldLines = cart.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
      }));

      const sale = await completeSale(
        cart.items,
        currentBranch.code,
        currentBranch.id,
        user.id,
        paymentMethod,
        amountPaid,
        customerNif,
        customerName,
      );

      applySoldQuantities(soldLines);
      cart.clearCart();
      setSearchTerm('');

      setLastSale(sale);
      setCheckoutOpen(false);
      await refreshProducts();
      void refreshSales();

      try {
        const printResult = await printPosThermalReceipts(sale, currentBranch, {
          openDrawer: paymentMethod === 'cash',
        });
        if (printResult.success) {
          void recordSalePrint(sale, { format: 'thermal', source: 'pos' });
          toast.success(t.receiptUi.autoPrintSuccess);
        }
      } catch (printError) {
        console.warn('[POS] Auto thermal print failed:', printError);
        toast.error(t.receiptUi.autoPrintError);
      }

      setReceiptOpen(true);

      if (paymentMethod === 'cash') {
        toast.info(t.posUi.saleCompleted, {
          description: t.posUi.cashPaymentRecorded,
        });
      }
    } catch (error) {
      console.error('Failed to complete sale:', error);
      const detail = error instanceof Error ? error.message : String(error);
      const friendly = /stock insuficiente|chk_products_stock_nonneg/i.test(detail)
        ? t.documentsUi.insufficientStockToCompleteSaleInvoice
        : detail;
      toast.error(t.posUi.completeSaleError, { description: friendly });
    }
  };

  const handleNewSale = () => {
    beginNewSaleSession();
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
      {/* Top: search + categories / products */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="p-3 border-b shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder={t.posUi.searchAndAdd}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-10 h-11"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <BranchSelector compact />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 text-xs gap-1.5 lg:hidden shrink-0"
              onClick={() =>
                navigate(
                  { pathname: location.pathname, search: location.search, hash: location.hash },
                  { state: NEXOR_POS_NEW_SALE_NAV_STATE },
                )
              }
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              {t.topNav.toolbar.newSale}
            </Button>
            <Badge variant={lastScannedBarcode ? 'default' : 'outline'} className="flex items-center gap-1.5 py-1.5 px-3">
              <ScanBarcode className="w-4 h-4" />
              {lastScannedBarcode ? lastScannedBarcode : t.posUi.scannerReady}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 text-xs gap-1.5 shrink-0"
              onClick={() => setEndOfDayOpen(true)}
            >
              <FileText className="w-3.5 h-3.5" />
              {t.posUi.endOfDayButton}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 h-9 w-9">
                  <Keyboard className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">{t.posUi.keyboardShortcuts}</h4>
                  <div className="space-y-1.5 text-sm">
                    {shortcuts.map((s) => (
                      <div key={s.key} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{s.description}</span>
                        <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">
                          {s.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-[10px] text-muted-foreground">{t.posUi.searchEnterHint}</p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-4">
          {productsLoading && products.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.common.loading}</p>
          ) : !branchId ? (
            <p className="text-sm text-muted-foreground">{t.posUi.selectBranchFirst}</p>
          ) : (
            <PosCategoryBrowser
              products={products}
              categories={categories}
              selectedCategory={selectedCategory}
              searchTerm={searchTerm}
              highlightedProductId={highlightedProductId}
              onSelectCategory={setSelectedCategory}
              onBack={handleBackToCategories}
              onProductSelect={addProductToCart}
              onGridColumnsChange={setSearchGridColumns}
            />
          )}
        </div>
      </div>

      {/* Bottom: cart dock */}
      <div className="shrink-0 border-t bg-card min-h-[9.5rem] max-h-[38vh] flex flex-col">
        <div className="px-3 py-1.5 border-b shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t.posUi.shoppingCartTitle}</h2>
          {currentBranch?.name && (
            <span className="text-xs text-muted-foreground">{currentBranch.name}</span>
          )}
        </div>
        <div className="flex-1 min-h-0 px-3 py-2 overflow-hidden">
          <Cart
            layout="dock"
            items={cart.items}
            subtotal={cart.subtotal}
            taxAmount={cart.taxAmount}
            total={cart.total}
            selectedCartProductId={selectedCartProductId}
            focusCartQtyProductId={focusCartQtyProductId}
            onFocusCartQtyHandled={() => setFocusCartQtyProductId(null)}
            onSelectCartLine={handleSelectCartLine}
            onUpdateQuantity={cart.updateQuantity}
            onRemoveItem={(productId) => {
              cart.removeItem(productId);
              if (productId === selectedCartProductId) {
                setSelectedCartProductId(null);
              }
            }}
            onCheckout={handleCheckout}
          />
        </div>
      </div>

      {/* Checkout Dialog */}
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        items={cart.items}
        total={cart.total}
        taxAmount={cart.taxAmount}
        onCompleteSale={handleCompleteSale}
      />

      {/* Receipt Dialog */}
      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        sale={lastSale}
        branch={currentBranch}
        onNewSale={handleNewSale}
      />

      <PosEndOfDayReportDialog
        open={endOfDayOpen}
        onOpenChange={setEndOfDayOpen}
        sales={sales}
        cashier={user}
        branch={currentBranch}
      />
    </div>
  );
}
