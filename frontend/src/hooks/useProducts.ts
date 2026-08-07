import { useState, useEffect, useCallback } from "react";
import { Product } from "@/types/inventory";
import { useToast } from "@/components/ui/use-toast";
import { getLocalData, saveLocalData, updateLocalData, deleteLocalData } from "@/lib/localDataService";
import { syncService } from "@/lib/syncService";

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Load from local storage immediately (Fast Load)
  const loadInitialData = useCallback(async () => {
    try {
      const cached = await getLocalData<Product>('products');
      if (cached.length > 0) {
        setProducts(cached);
        setLoading(false);
      }
      
      // Background Sync (Non-blocking)
      const freshData = await syncService.syncFromCloud('products');
      if (freshData) {
        setProducts(freshData as Product[]);
      }
    } catch (error) {
      console.warn("Fast load failed, waiting for sync:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const addProduct = async (product: Omit<Product, 'id' | 'created_at' | 'updated_at'>) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newProduct = { ...product, id, created_at: now, updated_at: now } as Product;

    // 1. Unified Operation (Local Save + Sync Queue)
    await syncService.performOperation('products', 'insert', newProduct);

    // 2. Update local state for immediate UI response
    setProducts(prev => [newProduct, ...prev]);

    toast({ title: "Success", description: "Product saved locally" });
    return newProduct;
  };

  const updateProductItem = async (id: string, updates: Partial<Product>) => {
    const updatedProduct = products.find(p => p.id === id);
    if (!updatedProduct) return;

    const merged = { ...updatedProduct, ...updates, updated_at: new Date().toISOString() };

    // 1. Unified Operation
    await syncService.performOperation('products', 'update', merged);

    // 2. Update local state
    setProducts(prev => prev.map(p => p.id === id ? merged : p));
    
    return merged;
  };

  const deleteProductItem = async (id: string) => {
    // 1. Unified Operation
    await syncService.performOperation('products', 'delete', { id });

    // 2. Update local state
    setProducts(prev => prev.filter(p => p.id !== id));
    
    toast({ title: "Success", description: "Product deleted" });
  };

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return {
    products,
    loading,
    addProduct,
    updateProduct: updateProductItem,
    deleteProduct: deleteProductItem,
    refreshProducts: loadInitialData,
  };
}
