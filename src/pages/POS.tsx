import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCart, useSales, useAuth, useClients } from '@/hooks/useERP';
import { effectiveUnitPrice, clientPricing, normalizePriceLevel } from '@/lib/pricing';
import { userHasPermission } from '@/lib/permissions';
import { getCompanySettings, saveCompanySettings } from '@/lib/companySettings';
import { api } from '@/lib/api/client';
import {
  printPosThermalReceipts,
  printReceipt,
  getPrinterConfig,
  POS_RECEIPT_COPY_LABELS,
} from '@/lib/thermalPrinter';
import { recordSalePrint } from '@/lib/recordPrintAudit';
import { usePosProducts } from '@/hooks/usePosProducts';
import { usePosCaixa } from '@/hooks/usePosCaixa';
import { processSalePayment } from '@/lib/accountingStorage';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useKeyboardShortcuts, KeyboardShortcut } from '@/hooks/useKeyboardShortcuts';
import { Sale, Product } from '@/types/erp';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { PosProductSearchList } from '@/components/pos/PosProductSearchList';
import { findPosProductByCode, filterPosProductsBySearch } from '@/lib/posProductSearch';
import { Cart } from '@/components/pos/Cart';
import { CheckoutDialog } from '@/components/pos/CheckoutDialog';
import { ReceiptDialog } from '@/components/pos/ReceiptDialog';
import { PrinterSettingsDialog } from '@/components/pos/PrinterSettingsDialog';
import { BranchSelector } from '@/components/BranchSelector';
import { Search, ScanBarcode, Keyboard, ShoppingCart, FileText, Check, ChevronsUpDown } from 'lucide-react';
import { PosEndOfDayReportDialog } from '@/components/pos/PosEndOfDayReportDialog';
import { PosOpenCaixaDialog } from '@/components/pos/PosOpenCaixaDialog';
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
  const cart = useCart();
  const { completeSale, sales, refreshSales } = useSales(currentBranch?.id);
  const { clients } = useClients();

  // Only admins/managers (anyone with `pos_price_change`) may pick the price tier.
  // Cashiers always get the admin-chosen default (or the selected client's level).
  const canChoosePrice = !!user && userHasPermission(user.role, user.permissionOverrides, 'pos_price_change');

  const [priceLevel, setPriceLevel] = useState(() =>
    normalizePriceLevel(getCompanySettings().posDefaultPriceLevel ?? 1),
  );
  // Company-wide fallback level, used only for walk-in sales at a branch that has no
  // explicit price level configured. A branch's own level overrides this.
  const [companyDefaultLevel, setCompanyDefaultLevel] = useState(() =>
    normalizePriceLevel(getCompanySettings().posDefaultPriceLevel ?? 1),
  );
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );
  const adjustmentPct = clientPricing(selectedClient).adjustmentPct;

  // Pull the company-wide default price level from the server and cache it. This is
  // only the fallback — each branch's own level (set in Filiais) takes precedence,
  // and a selected client's level wins over both.
  useEffect(() => {
    let cancelled = false;
    void api.companySettings
      .get()
      .then((res) => {
        if (cancelled) return;
        const serverLevel = normalizePriceLevel(res?.data?.posDefaultPriceLevel ?? 1);
        saveCompanySettings({ posDefaultPriceLevel: serverLevel });
        setCompanyDefaultLevel(serverLevel);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Effective ex-VAT unit price for the active price level + client % adjustment.
  const priceFor = useCallback(
    (product: Product) => effectiveUnitPrice(product, priceLevel, adjustmentPct),
    [priceLevel, adjustmentPct],
  );

  // Cart stores a product clone whose `price` is already the effective selling price.
  const toPricedProduct = useCallback(
    (product: Product): Product => ({ ...product, price: priceFor(product) }),
    [priceFor],
  );

  // Resolve the active price level by precedence: selected client's level wins, then
  // the current branch's configured level, then the company-wide default.
  useEffect(() => {
    if (selectedClient) {
      setPriceLevel(normalizePriceLevel(selectedClient.defaultPriceLevel ?? 1));
    } else if (currentBranch) {
      setPriceLevel(normalizePriceLevel(currentBranch.priceLevel ?? companyDefaultLevel));
    } else {
      setPriceLevel(companyDefaultLevel);
    }
  }, [selectedClient, currentBranch?.id, currentBranch?.priceLevel, companyDefaultLevel]);

  // Reprice existing cart lines when the price level or client adjustment changes.
  useEffect(() => {
    for (const item of cart.items) {
      const original = products.find((p) => p.id === item.product.id);
      if (!original) continue;
      const next = priceFor(original);
      if (next !== item.product.price) cart.repriceItem(item.product.id, next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceLevel, adjustmentPct]);

  const [searchTerm, setSearchTerm] = useState('');
  const [pendingQty, setPendingQty] = useState('1');
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(-1);
  const [selectedCartProductId, setSelectedCartProductId] = useState<string | null>(null);
  const [focusCartQtyProductId, setFocusCartQtyProductId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [endOfDayOpen, setEndOfDayOpen] = useState(false);
  const {
    session: caixaSession,
    loading: caixaLoading,
    openSession: openCaixaSessionForBranch,
    closeSession: closeCaixaSessionForBranch,
    recordCashSale,
  } = usePosCaixa(currentBranch?.id, currentBranch?.name);
  const [openingCaixa, setOpeningCaixa] = useState(false);
  const caixaOpen = !!caixaSession;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const navigableSearchResults = useMemo(
    () => filterPosProductsBySearch(products, searchTerm),
    [products, searchTerm],
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

  const focusQty = useCallback(() => {
    qtyInputRef.current?.focus();
    qtyInputRef.current?.select();
  }, []);

  const addProductToCart = useCallback(
    (product: Product) => {
      const parsedQty = parseFloat(pendingQty);
      const qty = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
      cart.addItem(toPricedProduct(product), qty);
      setSelectedCartProductId(product.id);
      // Keep focus on the POS qty box for the next product instead of grabbing
      // focus into the cart line (which would send Tab to the checkout button).
      toast.success(t.posUi.itemAdded.replace('{name}', product.name));
      setPendingQty('1');
      setTimeout(focusQty, 0);
    },
    [cart, pendingQty, focusQty, t.posUi, toPricedProduct],
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
      // Tab (forward) loops back to the qty box to start the next product.
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        focusQty();
        return;
      }
      if (navigableSearchResults.length === 0) {
        // Nothing to navigate — Arrow Down jumps to the qty box.
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusQty();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSearchHighlightIndex((prev) => {
          const start = prev < 0 ? -1 : prev;
          return Math.min(start + 1, navigableSearchResults.length - 1);
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSearchHighlightIndex((prev) => {
          const start = prev < 0 ? navigableSearchResults.length : prev;
          return Math.max(start - 1, 0);
        });
      }
    },
    [handleSearchSubmit, navigableSearchResults, focusQty],
  );

  const handleSelectCartLine = useCallback((productId: string) => {
    setSelectedCartProductId(productId);
    setFocusCartQtyProductId(productId);
  }, []);

  const handleBarcodeScan = useCallback(
    (barcode: string) => {
      const product = findPosProductByCode(products, barcode);
      if (product) {
        cart.addItem(toPricedProduct(product));
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
    [products, cart, t.posUi, toPricedProduct],
  );

  useBarcodeScanner({ onScan: handleBarcodeScan });

  const handleCheckout = useCallback(() => {
    if (!caixaOpen) {
      toast.error(t.posUi.caixa.requiredToSell, { description: t.posUi.caixa.openDesc });
      return;
    }
    if (cart.items.length > 0) {
      setCheckoutOpen(true);
    } else {
      toast.info(t.posUi.emptyCart, { description: t.posUi.addProductsToCheckout });
    }
  }, [caixaOpen, cart.items.length, t.posUi]);

  const handleClearCart = useCallback(() => {
    if (cart.items.length > 0) {
      cart.clearCart();
      setSelectedCartProductId(null);
      setFocusCartQtyProductId(null);
      toast.info(t.posUi.cartCleared);
    }
  }, [cart, t.posUi]);

  const beginNewSaleSession = useCallback(() => {
    cart.clearCart();
    setCheckoutOpen(false);
    setReceiptOpen(false);
    setLastSale(null);
    setSearchTerm('');
    setSearchHighlightIndex(-1);
    setSelectedCartProductId(null);
    setFocusCartQtyProductId(null);
    setSelectedClientId('');
    setPriceLevel(1);
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

  const handleEscape = useCallback(() => {
    if (searchTerm.trim()) {
      clearSearch();
      return;
    }
    handleClearCart();
  }, [searchTerm, clearSearch, handleClearCart]);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const shortcuts: KeyboardShortcut[] = useMemo(
    () => [
      { key: 'F12', action: handleCheckout, description: t.posUi.checkoutShortcut },
      { key: 'Escape', action: handleEscape, description: t.posUi.escapeShortcut },
      { key: 'F2', action: focusSearch, description: t.posUi.searchProductShortcut },
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
    [handleCheckout, handleEscape, focusSearch, cart, t.posUi],
  );

  useKeyboardShortcuts({ shortcuts, enabled: !checkoutOpen && !receiptOpen });

  const handleCompleteSale = async (
    paymentMethod: Sale['paymentMethod'],
    amountPaid: number,
    customerNif?: string,
    customerName?: string,
    discountPct = 0,
    clientId?: string,
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
        discountPct,
        clientId,
      );

      applySoldQuantities(soldLines);
      cart.clearCart();
      setSearchTerm('');

      setLastSale(sale);
      setCheckoutOpen(false);
      // Show the receipt immediately — stock was already updated optimistically via
      // applySoldQuantities. Refreshing the product/sales lists is a slow LAN round-trip,
      // so do it in the background instead of blocking the print screen.
      setReceiptOpen(true);
      void refreshProducts();
      void refreshSales();

      // Record cash takings against the open shift for end-of-day reconciliation.
      // Tracked in memory so the open-caixa gate stays closed; also persisted to the
      // caixa ledger on a best-effort basis (no-op in SQLite desktop mode, where the
      // accounting store is reserved for the Express backend).
      if (paymentMethod === 'cash') {
        recordCashSale(sale.total);
        void processSalePayment(
          currentBranch.id,
          sale.id,
          sale.invoiceNumber,
          sale.total,
          'cash',
          user.id,
          customerName,
        ).catch((caixaErr) => console.warn('[POS] Failed to post sale to caixa:', caixaErr));
      }

      try {
        const printResult = await printPosThermalReceipts(sale, currentBranch, {
          openDrawer: paymentMethod === 'cash',
        });
        if (printResult.success) {
          void recordSalePrint(sale, { format: 'thermal', source: 'pos' });
          toast.success(t.receiptUi.autoPrintSuccess);
        } else if (printResult.needsPrinterSetup) {
          // No silent printer configured — still print automatically by opening
          // the thermal receipt in the browser/OS print dialog (no A4, no manual click).
          const fallback = await printReceipt(sale, currentBranch, getPrinterConfig(), {
            openDrawer: paymentMethod === 'cash',
            copies: POS_RECEIPT_COPY_LABELS.length,
            copyLabels: [...POS_RECEIPT_COPY_LABELS],
            allowDialogFallback: true,
          });
          if (fallback.success) {
            void recordSalePrint(sale, { format: 'thermal', source: 'pos' });
            toast.success(t.receiptUi.autoPrintSuccess);
          } else {
            toast.error(t.receiptUi.printerSetupRequired, {
              description: t.receiptUi.printerSetupRequiredDesc,
            });
          }
        } else {
          toast.error(t.receiptUi.autoPrintError);
        }
      } catch (printError) {
        console.warn('[POS] Auto thermal print failed:', printError);
        toast.error(t.receiptUi.autoPrintError);
      }

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

  const handleOpenCaixa = async (openingCash: number) => {
    if (!user) return;
    setOpeningCaixa(true);
    try {
      await openCaixaSessionForBranch(openingCash, user.name || user.username || 'POS');
      toast.success(t.posUi.caixa.openedToast, {
        description: `${t.posUi.caixa.openingCashLabel}: ${openingCash.toLocaleString('pt-AO')} Kz`,
      });
    } catch (err) {
      console.error('[POS] Failed to open caixa:', err);
      toast.error(t.posUi.caixa.openError);
    } finally {
      setOpeningCaixa(false);
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
      {/* Top: cart list */}
      <div className="flex-1 min-h-0 flex flex-col bg-card border-b">
        <div className="px-3 py-1.5 border-b shrink-0 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t.posUi.shoppingCartTitle}</h2>
          {currentBranch?.name && (
            <span className="text-xs text-muted-foreground">{currentBranch.name}</span>
          )}
        </div>
        <div className="flex-1 min-h-0 px-3 py-2 overflow-hidden">
          {productsLoading && products.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t.common.loading}</p>
          ) : !branchId ? (
            <p className="text-sm text-muted-foreground py-4">{t.posUi.selectBranchFirst}</p>
          ) : (
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
          )}
        </div>
      </div>

      {/* Search results when typing */}
      {branchId && (
        <PosProductSearchList
          products={products}
          searchTerm={searchTerm}
          highlightedProductId={highlightedProductId}
          onProductSelect={(product) => {
            addProductToCart(product);
            clearSearch();
          }}
        />
      )}

      {/* Bottom: search + tools */}
      <div className="shrink-0 p-3 border-t bg-background space-y-2">
        <div className="flex items-center gap-2">
          <Input
            ref={qtyInputRef}
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            value={pendingQty}
            onChange={(e) => setPendingQty(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                focusSearch();
              }
            }}
            className="h-11 w-16 text-center shrink-0"
            title={t.common.quantity}
            aria-label={t.common.quantity}
          />
          <div className="relative flex-1">
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
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BranchSelector compact />
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{t.posUi.clientLabel}</Label>
            <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={clientPickerOpen}
                  className="h-9 w-[200px] justify-between text-xs font-normal"
                >
                  <span className="truncate">
                    {selectedClient ? selectedClient.name : t.posUi.walkInCustomer}
                  </span>
                  <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[260px] p-0" align="start">
                <Command>
                  <CommandInput placeholder={t.posUi.clientLabel} className="text-xs" />
                  <CommandList>
                    <CommandEmpty>{t.common.noResults}</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value={t.posUi.walkInCustomer}
                        onSelect={() => {
                          setSelectedClientId('');
                          setClientPickerOpen(false);
                        }}
                      >
                        <Check
                          className={`mr-2 h-3.5 w-3.5 ${selectedClientId ? 'opacity-0' : 'opacity-100'}`}
                        />
                        {t.posUi.walkInCustomer}
                      </CommandItem>
                      {clients.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={`${c.name} ${c.nif ?? ''} ${c.phone ?? ''}`}
                          onSelect={() => {
                            setSelectedClientId(c.id);
                            setClientPickerOpen(false);
                          }}
                        >
                          <Check
                            className={`mr-2 h-3.5 w-3.5 ${selectedClientId === c.id ? 'opacity-100' : 'opacity-0'}`}
                          />
                          <span className="flex-1 truncate">{c.name}</span>
                          {c.nif && (
                            <span className="ml-2 text-[10px] text-muted-foreground">{c.nif}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{t.posUi.priceLabel}</Label>
            {canChoosePrice ? (
              <Select value={String(priceLevel)} onValueChange={(v) => setPriceLevel(Number(v))}>
                <SelectTrigger className="h-9 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t.posUi.priceLevelOption.replace('{n}', String(n))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge
                variant="outline"
                className="h-9 px-3 text-xs font-normal shrink-0"
                title={t.posUi.priceLevelLocked}
              >
                {t.posUi.priceLevelOption.replace('{n}', String(priceLevel))}
              </Badge>
            )}
            {adjustmentPct !== 0 && (
              <Badge variant="secondary" className="shrink-0">
                {adjustmentPct > 0 ? '+' : ''}{adjustmentPct}%
              </Badge>
            )}
          </div>
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
                      <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{s.key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-[10px] text-muted-foreground">{t.posUi.searchEnterHint}</p>
      </div>

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        items={cart.items}
        total={cart.total}
        taxAmount={cart.taxAmount}
        defaultCustomerNif={selectedClient?.nif}
        defaultCustomerName={selectedClient?.name}
        registeredClientId={selectedClient?.id}
        onCompleteSale={handleCompleteSale}
      />

      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        sale={lastSale}
        branch={currentBranch}
        onNewSale={handleNewSale}
      />

      <PrinterSettingsDialog
        open={printerSettingsOpen}
        onOpenChange={setPrinterSettingsOpen}
      />

      <PosEndOfDayReportDialog
        open={endOfDayOpen}
        onOpenChange={setEndOfDayOpen}
        sales={sales}
        cashier={user}
        branch={currentBranch}
        session={caixaSession}
        onCloseCaixa={async (countedCash, notes) => {
          if (!user) return;
          await closeCaixaSessionForBranch(
            countedCash,
            user.name || user.username || 'POS',
            notes,
          );
        }}
      />

      <PosOpenCaixaDialog
        open={!!currentBranch && !caixaLoading && !caixaOpen}
        branchName={currentBranch?.name}
        cashierName={user?.name || user?.username}
        submitting={openingCaixa}
        onConfirm={handleOpenCaixa}
      />
    </div>
  );
}
