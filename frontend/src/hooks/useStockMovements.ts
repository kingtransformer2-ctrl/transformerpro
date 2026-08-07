import { useState, useEffect } from "react";
import { apiClient } from "@/integrations/supabase/client";
import { StockMovement } from "@/types/inventory";
import { useToast } from "@/components/ui/use-toast";

export function useStockMovements() {
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchStockMovements = async () => {
    try {
      const { data, error } = await apiClient
        .from('stock_movements')
        .select(`
          *,
          product:products(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStockMovements((data || []) as StockMovement[]);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch stock movements",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addStockMovement = async (movement: {
    product_id: string;
    movement_type: 'in' | 'out' | 'adjustment';
    quantity: number;
    reason: string;
    notes?: string;
  }) => {
    try {
      // Create stock movement
      const { data: movementData, error: movementError } = await apiClient
        .from('stock_movements')
        .insert([movement])
        .select()
        .single();

      if (movementError) throw movementError;

      // Update product stock quantity
      const { data: product, error: productFetchError } = await apiClient
        .from('products')
        .select('stock_quantity')
        .eq('id', movement.product_id)
        .single();

      if (productFetchError) throw productFetchError;

      let newQuantity = product.stock_quantity;
      if (movement.movement_type === 'in') {
        newQuantity += movement.quantity;
      } else if (movement.movement_type === 'out') {
        newQuantity -= movement.quantity;
      } else if (movement.movement_type === 'adjustment') {
        newQuantity = movement.quantity; // For adjustments, the quantity is the new total
      }

      const { error: updateError } = await apiClient
        .from('products')
        .update({ stock_quantity: newQuantity })
        .eq('id', movement.product_id);

      if (updateError) throw updateError;

      await fetchStockMovements();
      toast({
        title: "Success",
        description: "Stock movement recorded successfully",
      });
      
      return movementData;
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to record stock movement",
        variant: "destructive",
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchStockMovements();
  }, []);

  return {
    stockMovements,
    loading,
    addStockMovement,
    refreshStockMovements: fetchStockMovements,
  };
}
