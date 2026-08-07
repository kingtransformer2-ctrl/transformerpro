import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface HotelStockMovement {
  id: string;
  service_item_id: string;
  movement_type: 'in' | 'out' | 'adjustment';
  quantity: number;
  unit_cost: number;
  total_cost: number;
  reason: string;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  service_item?: {
    id: string;
    name: string;
    category: string;
  };
}

export interface StockMovementInsert {
  service_item_id: string;
  movement_type: 'in' | 'out' | 'adjustment';
  quantity: number;
  unit_cost?: number;
  total_cost?: number;
  reason: string;
  reference_id?: string;
  notes?: string;
  shift_id?: string | null;
  created_by?: string | null;
}

export function useHotelStockMovements(serviceItemId?: string) {
  return useQuery({
    queryKey: ['hotel-stock-movements', serviceItemId],
    queryFn: async () => {
      let query = apiClient
        .from('hotel_stock_movements')
        .select(`
          *,
          service_item:hotel_service_menu(id, name, category)
        `)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (serviceItemId) {
        query = query.eq('service_item_id', serviceItemId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as HotelStockMovement[];
    },
  });
}

export function useAddHotelStockMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (movement: StockMovementInsert) => {
      // 1. Get current item data
      const { data: item } = await apiClient
        .from('hotel_service_menu')
        .select('stock_quantity, purchase_price')
        .eq('id', movement.service_item_id)
        .single();

      if (!item) throw new Error('Service item not found');

      const currentStock = Number(item.stock_quantity || 0);
      const currentPurchasePrice = Number(item.purchase_price || 0);
      let newStock = currentStock;

      if (movement.movement_type === 'in') {
        newStock = currentStock + movement.quantity;
      } else if (movement.movement_type === 'out') {
        newStock = Math.max(0, currentStock - movement.quantity);
      } else if (movement.movement_type === 'adjustment') {
        newStock = movement.quantity;
      }

      // 2. Prepare movement data with costs
      const unitCost = movement.unit_cost || currentPurchasePrice;
      const totalCost = movement.total_cost || (unitCost * movement.quantity);

      const { data: movementData, error: movementError } = await apiClient
        .from('hotel_stock_movements')
        .insert([{
          ...movement,
          unit_cost: unitCost,
          total_cost: totalCost
        }])
        .select()
        .single();

      if (movementError) throw movementError;

      // 3. Update the stock quantity on the service item
      const { error: updateError } = await apiClient
        .from('hotel_service_menu')
        .update({ 
          stock_quantity: newStock, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', movement.service_item_id);

      if (updateError) throw updateError;

      return movementData;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hotel-stock-movements'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu', 'available'] });
      
      const typeLabel = variables.movement_type === 'in' ? 'Stock added' : 
                       variables.movement_type === 'out' ? 'Stock deducted' : 'Stock adjusted';
      toast.success(typeLabel);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useLowStockItems() {
  return useQuery({
    queryKey: ['service-menu', 'low-stock'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_service_menu')
        .select('*')
        .eq('track_stock', true)
        .eq('is_available', true);
      
      if (error) throw error;
      
      // Filter items where stock is below threshold
      return data.filter(item => item.stock_quantity <= item.min_stock_threshold);
    },
  });
}
