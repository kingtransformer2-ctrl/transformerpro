import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { apiClient } from "@/integrations/supabase/client";
import { Product, ProductBatch, StockMovement, SaleItem } from "@/types/inventory";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { format } from "date-fns";
import { Package, TrendingDown, TrendingUp, ShoppingCart, AlertTriangle } from "lucide-react";

interface ProductDetailsDialogProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductDetailsDialog({ product, open, onOpenChange }: ProductDetailsDialogProps) {
  const { formatCurrency, formatDate } = useSettingsContext();
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [salesHistory, setSalesHistory] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (product && open) {
      fetchProductDetails();
    }
  }, [product, open]);

  const fetchProductDetails = async () => {
    if (!product) return;
    
    setLoading(true);
    try {
      // Fetch batches
      const { data: batchesData } = await apiClient
        .from('product_batches')
        .select('*')
        .eq('product_id', product.id)
        .order('received_date', { ascending: false });
      
      // Fetch stock movements
      const { data: movementsData } = await apiClient
        .from('stock_movements')
        .select('*')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(20);
      
      // Fetch sales history
      const { data: salesData } = await apiClient
        .from('sale_items')
        .select('*, sales(*)')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(20);
      
      setBatches(batchesData || []);
      setStockMovements((movementsData || []) as StockMovement[]);
      setSalesHistory(salesData || []);
    } catch (error) {
      console.error('Error fetching product details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!product) return null;

  const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);
  const totalValue = batches.reduce((sum, batch) => sum + (batch.quantity * batch.selling_price), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Package className="h-5 w-5" />
            {product.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Product Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Barcode</p>
              <p className="font-medium">{product.barcode || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Category</p>
              <p className="font-medium">{product.category || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Selling Price</p>
              <p className="font-medium">{formatCurrency(product.selling_price)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Stock</p>
              <div className="flex items-center gap-2">
                <p className="font-medium">{totalStock}</p>
                {totalStock < product.min_stock_threshold && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Low
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {product.description && (
            <div>
              <p className="text-sm text-muted-foreground">Description</p>
              <p className="text-sm mt-1">{product.description}</p>
            </div>
          )}

          <Separator />

          {/* Tabs */}
          <Tabs defaultValue="batches" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="batches">Batches ({batches.length})</TabsTrigger>
              <TabsTrigger value="movements">Stock Movements ({stockMovements.length})</TabsTrigger>
              <TabsTrigger value="sales">Sales History ({salesHistory.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="batches" className="space-y-3">
              <div className="bg-muted/50 p-4 rounded-lg grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total Inventory Value</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Batches</p>
                  <p className="text-2xl font-bold">{batches.filter(b => b.quantity > 0).length}</p>
                </div>
              </div>
              
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {batches.map((batch) => (
                  <div key={batch.id} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium">{batch.batch_number}</p>
                        <p className="text-sm text-muted-foreground">{batch.supplier || "Unknown Supplier"}</p>
                      </div>
                      <Badge variant={batch.quantity > 0 ? "default" : "secondary"}>
                        {batch.quantity} units
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Purchase</p>
                        <p className="font-medium">{formatCurrency(batch.purchase_price)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Selling</p>
                        <p className="font-medium">{formatCurrency(batch.selling_price)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Received</p>
                        <p className="font-medium">{formatDate(batch.received_date)}</p>
                      </div>
                    </div>
                    {batch.expiry_date && (
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-sm text-muted-foreground">
                          Expires: {formatDate(batch.expiry_date)}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {batches.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No batches found</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="movements" className="space-y-2 max-h-96 overflow-y-auto">
              {stockMovements.map((movement) => (
                <div key={movement.id} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      {movement.movement_type === 'in' ? (
                        <TrendingUp className="h-4 w-4 text-green-600" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600" />
                      )}
                      <div>
                        <p className="font-medium">{movement.reason}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(movement.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-medium ${movement.movement_type === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                        {movement.movement_type === 'in' ? '+' : '-'}{movement.quantity}
                      </p>
                    </div>
                  </div>
                  {movement.notes && (
                    <p className="text-sm text-muted-foreground mt-2">{movement.notes}</p>
                  )}
                </div>
              ))}
              {stockMovements.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No stock movements found</p>
              )}
            </TabsContent>

            <TabsContent value="sales" className="space-y-2 max-h-96 overflow-y-auto">
              {salesHistory.map((item: any) => (
                <div key={item.id} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="h-4 w-4" />
                      <div>
                        <p className="font-medium">Sale #{item.sales?.sale_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(item.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{item.quantity} units</p>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(item.total_price)}
                      </p>
                    </div>
                  </div>
                  {item.sales?.customer_name && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Customer: {item.sales.customer_name}
                    </p>
                  )}
                </div>
              ))}
              {salesHistory.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No sales history found</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
