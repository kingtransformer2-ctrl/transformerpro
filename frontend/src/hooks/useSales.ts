import { useState, useEffect, useCallback } from "react";
import { Sale, CartItem } from "@/types/inventory";
import { useToast } from "@/components/ui/use-toast";
import { getLocalData, saveLocalData } from "@/lib/localDataService";
import { syncService } from "@/lib/syncService";

export function useSales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadInitialData = useCallback(async () => {
    try {
      const cached = await getLocalData<Sale>('sales');
      if (cached.length > 0) {
        setSales(cached);
        setLoading(false);
      }
      
      // Background Sync
      const freshData = await syncService.syncFromCloud('sales');
      if (freshData) {
        setSales(freshData as Sale[]);
      }
    } catch (error) {
      console.warn("Fast load failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSale = async (
    saleData: Omit<Sale, 'id' | 'sale_number' | 'created_at'>,
    items: CartItem[],
    customerId?: string
  ) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const saleNumber = `S-${Math.floor(Math.random() * 1000000)}`;
    
    const newSale = {
      ...saleData,
      id,
      sale_number: saleNumber,
      customer_id: customerId,
      created_at: now,
    } as Sale;

    // Create sale items with unique IDs
    const saleItems = items.map(item => ({
      id: crypto.randomUUID(),
      sale_id: id,
      product_id: item.product.id,
      quantity: item.quantity,
      unit_price: item.product.selling_price,
      total_price: item.quantity * item.product.selling_price,
      created_at: now
    }));

    // 1. Unified Operation for Sale
    await syncService.performOperation('sales', 'insert', newSale);
    
    // 2. Unified Operation for Sale Items (Batch insert locally, individual queue items)
    // We loop to ensure each item is in the sync queue
    for (const item of saleItems) {
      await syncService.performOperation('sale_items', 'insert', item);
    }

    // 3. Update local state
    setSales(prev => [newSale, ...prev]);

    toast({ title: "Success", description: `Sale ${saleNumber} completed` });
    return newSale;
  };

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return {
    sales,
    loading,
    createSale,
    refreshSales: loadInitialData,
  };
}
