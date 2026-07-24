import { Product } from '@/types/erp';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface ProductGridProps {
  products: Product[];
  onProductSelect: (product: Product) => void;
  searchTerm: string;
}

export function ProductGrid({ products, onProductSelect, searchTerm }: ProductGridProps) {
  const { t, language } = useTranslation();
  const list = products ?? [];
  const filteredProducts = list.filter(product =>
    product.isActive &&
    (product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
     product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
     product.barcode?.includes(searchTerm))
  );

  const inStock = filteredProducts.filter((p) => (Number(p.stock) || 0) > 0);
  const categories = [...new Set(inStock.map(p => p.category))];

  if (inStock.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-center px-4">
        <Package className="w-12 h-12 mb-2" />
        <p>{filteredProducts.length > 0 ? t.pos.noStockProducts : t.posUi.productNotFound}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {categories.map(category => (
        <div key={category}>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">{category}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredProducts
              .filter(p => p.category === category && (Number(p.stock) || 0) > 0)
              .map(product => (
                <Card
                  key={product.id}
                  className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/50 ${
                    product.stock <= 0 ? 'opacity-50' : ''
                  }`}
                  onClick={() => product.stock > 0 && onProductSelect(product)}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between">
                        <h4 className="font-medium text-sm leading-tight line-clamp-2">
                          {product.name}
                        </h4>
                      </div>
                      <p className="text-xs text-muted-foreground">{product.sku}</p>
                      <div className="flex items-center justify-between mt-1 gap-2">
                        <span className="text-lg font-bold text-primary">
                          {product.price.toLocaleString('pt-AO')} Kz
                        </span>
                        <div className="text-right shrink-0">
                          <Badge variant={product.stock > 10 ? 'secondary' : 'destructive'}>
                            {product.stock} {product.unit}
                          </Badge>
                          {(Number(product.reservedStock) || 0) > 0 && (
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              {language === 'pt' ? 'reserv.' : 'rsvd'} {product.reservedStock}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
