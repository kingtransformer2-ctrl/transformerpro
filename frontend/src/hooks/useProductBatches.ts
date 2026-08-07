import { useState, useEffect } from "react";
import { apiClient } from "@/integrations/supabase/client";
import { ProductBatch } from "@/types/inventory";
import { useToast } from "@/components/ui/use-toast";

export function useProductBatches(productId?: string) {
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchBatches = async () => {
    try {
      let query = apiClient
        .from('product_batches')
        .select('*, product:products(*)')
        .order('expiry_date', { ascending: true });

      if (productId) {
        query = query.eq('product_id', productId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setBatches(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch product batches",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addBatch = async (batch: Omit<ProductBatch, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const { data, error } = await apiClient
        .from('product_batches')
        .insert([batch])
        .select()
        .single();

      if (error) throw error;
      
      setBatches(prev => [data, ...prev]);
      toast({
        title: "Success",
        description: "Product batch added successfully",
      });
      return data;
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add product batch",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateBatch = async (id: string, updates: Partial<ProductBatch>) => {
    try {
      const { data, error } = await apiClient
        .from('product_batches')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      
      setBatches(prev => prev.map(b => b.id === id ? data : b));
      toast({
        title: "Success",
        description: "Product batch updated successfully",
      });
      return data;
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update product batch",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteBatch = async (id: string) => {
    try {
      const { error } = await apiClient
        .from('product_batches')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setBatches(prev => prev.filter(b => b.id !== id));
      toast({
        title: "Success",
        description: "Product batch deleted successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete product batch",
        variant: "destructive",
      });
      throw error;
    }
  };

  const getBatchesForSale = async (productId: string, quantity: number) => {
    // FEFO (First Expired First Out) logic
    const productBatches = batches
      .filter(b => b.product_id === productId && b.quantity > 0)
      .sort((a, b) => {
        if (!a.expiry_date && !b.expiry_date) return 0;
        if (!a.expiry_date) return 1;
        if (!b.expiry_date) return -1;
        return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
      });

    const selectedBatches: { batch: ProductBatch; quantity: number }[] = [];
    let remainingQuantity = quantity;

    for (const batch of productBatches) {
      if (remainingQuantity <= 0) break;
      
      const takeQuantity = Math.min(batch.quantity, remainingQuantity);
      selectedBatches.push({ batch, quantity: takeQuantity });
      remainingQuantity -= takeQuantity;
    }

    // If no batches exist, check the product's main stock_quantity
    if (productBatches.length === 0) {
      try {
        const { data: product } = await apiClient
          .from('products')
          .select('stock_quantity')
          .eq('id', productId)
          .single();
        
        if (product && product.stock_quantity >= quantity) {
          return { selectedBatches: [], canFulfill: true };
        }
      } catch (error) {
        console.error('Error checking product stock:', error);
      }
    }

    return { selectedBatches, canFulfill: remainingQuantity === 0 };
  };

  useEffect(() => {
    fetchBatches();
  }, [productId]);

  return {
    batches,
    loading,
    addBatch,
    updateBatch,
    deleteBatch,
    getBatchesForSale,
    refreshBatches: fetchBatches,
  };
}
