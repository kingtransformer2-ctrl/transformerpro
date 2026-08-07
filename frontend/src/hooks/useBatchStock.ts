import { useState, useEffect } from "react";
import { apiClient } from "@/integrations/supabase/client";
import { Product } from "@/types/inventory";

interface BatchStockData {
  [productId: string]: {
    totalStock: number;
    nextExpiryDate?: string;
    currentSellingPrice?: number;
  };
}

export function useBatchStock(products?: Product[]) {
  const [batchStock, setBatchStock] = useState<BatchStockData>({});
  const [loading, setLoading] = useState(true);

  const fetchBatchStock = async () => {
    try {
      const { data, error } = await apiClient
        .from('product_batches')
        .select('product_id, quantity, expiry_date, selling_price')
        .gt('quantity', 0);

      if (error) throw error;

      const stockData: BatchStockData = {};
      
      data?.forEach(batch => {
        if (!stockData[batch.product_id]) {
          stockData[batch.product_id] = {
            totalStock: 0,
            nextExpiryDate: batch.expiry_date,
            currentSellingPrice: batch.selling_price
          };
        }
        
        stockData[batch.product_id].totalStock += batch.quantity;
        
        // Update next expiry date if this batch expires sooner
        if (batch.expiry_date && 
            (!stockData[batch.product_id].nextExpiryDate || 
             batch.expiry_date < stockData[batch.product_id].nextExpiryDate!)) {
          stockData[batch.product_id].nextExpiryDate = batch.expiry_date;
        }
      });

      setBatchStock(stockData);
    } catch (error) {
      console.error('Error fetching batch stock:', error);
    } finally {
      setLoading(false);
    }
  };

  const getProductStock = (productId: string) => {
    // If there are batches for this product, use batch stock
    if (batchStock[productId]?.totalStock > 0) {
      return batchStock[productId].totalStock;
    }
    
    // Otherwise, fallback to product's stock_quantity
    const product = products?.find(p => p.id === productId);
    return product?.stock_quantity || 0;
  };

  const getProductNextExpiry = (productId: string) => {
    return batchStock[productId]?.nextExpiryDate;
  };

  const getProductCurrentPrice = (productId: string) => {
    return batchStock[productId]?.currentSellingPrice;
  };

  useEffect(() => {
    fetchBatchStock();

    // Subscribe to real-time changes in product_batches
    const subscription = apiClient
      .channel('product_batches_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'product_batches' },
        () => {
          fetchBatchStock();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return {
    batchStock,
    loading,
    getProductStock,
    getProductNextExpiry,
    getProductCurrentPrice,
    refreshBatchStock: fetchBatchStock,
  };
}
