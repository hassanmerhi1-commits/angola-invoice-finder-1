import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProducts, useCart, useSales, useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useKeyboardShortcuts, KeyboardShortcut } from '@/hooks/useKeyboardShortcuts';
import { Sale, Product } from '@/types/erp';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { Cart } from '@/components/pos/Cart';
import { CheckoutDialog } from '@/components/pos/CheckoutDialog';
import { ReceiptDialog } from '@/components/pos/ReceiptDialog';
import { BranchSelector } from '@/components/BranchSelector';
import { Search, ScanBarcode, Keyboard, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { readNexorPosNewSaleFlag, NEXOR_POS_NEW_SALE_NAV_STATE } from '@/lib/nexorPosNewSale';

export default function POS() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentBranch } = useBranchContext();
  const { products, refreshProducts } = useProducts(currentBranch?.id);
  const { user } = useAuth();
  const { t } = useTranslation();
  const cart = useCart();
  const { completeSale } = useSales(currentBranch?.id);

  const [searchTerm, setSearchTerm] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Handle barcode scan
  const handleBarcodeScan = useCallback(
    (barcode: string) => {
      // Don't process if user is typing in the search input
      if (document.activeElement === searchInputRef.current) {
        return;
      }

      const product = products.find(
        (p) =>
          p.isActive &&
          p.stock > 0 &&
          (p.barcode === barcode ||
            p.sku.toLowerCase() === barcode.toLowerCase())
      );

      if (product) {
        cart.addItem(product);
        setLastScannedBarcode(barcode);
        toast.success(t.posUi.itemAdded.replace('{name}', product.name), {
          description: `${t.posUi.code}: ${barcode}`,
        });
        // Clear indicator after 2 seconds
        setTimeout(() => setLastScannedBarcode(null), 2000);
      } else {
        toast.error(t.posUi.productNotFound, {
          description: `${t.posUi.code}: ${barcode}`,
        });
      }
    },
    [products, cart]
  );

  useBarcodeScanner({ onScan: handleBarcodeScan });

  const handleCheckout = useCallback(() => {
    if (cart.items.length > 0) {
      setCheckoutOpen(true);
    } else {
      toast.info(t.posUi.emptyCart, { description: t.posUi.addProductsToCheckout });
    }
  }, [cart.items.length]);

  const handleClearCart = useCallback(() => {
    if (cart.items.length > 0) {
      cart.clearCart();
      toast.info(t.posUi.cartCleared);
    }
  }, [cart]);

  /** Same as receipt “Nova venda”: cart + checkout + receipt + last sale (TopNav / deep links). */
  const beginNewSaleSession = useCallback(() => {
    cart.clearCart();
    setCheckoutOpen(false);
    setReceiptOpen(false);
    setLastSale(null);
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
    window.addEventListener('nexor:pos-new-sale', onToolbarNewSale);
    return () => window.removeEventListener('nexor:pos-new-sale', onToolbarNewSale);
  }, [beginNewSaleSession]);

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
        action: handleClearCart,
        description: t.posUi.clearCartShortcut,
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
    [handleCheckout, handleClearCart, focusSearch, cart]
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

      setLastSale(sale);
      setCheckoutOpen(false);
      setReceiptOpen(true);
      refreshProducts();
      
      // Show feedback for cash payments
      if (paymentMethod === 'cash') {
        toast.info(t.posUi.saleCompleted, {
          description: t.posUi.cashPaymentRecorded,
        });
      }
    } catch (error) {
      console.error('Failed to complete sale:', error);
      toast.error(t.posUi.completeSaleError);
    }
  };

  const handleNewSale = () => {
    beginNewSaleSession();
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Products Section */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center gap-3 flex-wrap">
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
            <div className="relative flex-1 min-w-[12rem]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder={t.pos.searchProducts}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Badge variant={lastScannedBarcode ? 'default' : 'outline'} className="flex items-center gap-1.5 py-1.5 px-3">
              <ScanBarcode className="w-4 h-4" />
              {lastScannedBarcode ? lastScannedBarcode : t.posUi.scannerReady}
            </Badge>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0">
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
        </div>
        <div className="flex-1 overflow-auto p-4">
          <ProductGrid
            products={products}
            onProductSelect={(product) => cart.addItem(product)}
            searchTerm={searchTerm}
          />
        </div>
      </div>

      {/* Cart Section */}
      <div className="w-96 border-l bg-card flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold">{t.posUi.shoppingCartTitle}</h2>
          <p className="text-xs text-muted-foreground">{currentBranch?.name}</p>
        </div>
        <div className="flex-1 p-4 overflow-hidden">
          <Cart
            items={cart.items}
            subtotal={cart.subtotal}
            taxAmount={cart.taxAmount}
            total={cart.total}
            onUpdateQuantity={cart.updateQuantity}
            onRemoveItem={cart.removeItem}
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
    </div>
  );
}
