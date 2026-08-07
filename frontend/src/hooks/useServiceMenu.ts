import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ServiceMenuItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  selling_price: number;
  purchase_price: number;
  is_available: boolean;
  sort_order: number;
  track_stock: boolean;
  stock_quantity: number;
  min_stock_threshold: number;
  inventory_source_location: 'kitchen' | 'bar';
  use_recipe: boolean;
  direct_ingredient_id: string | null;
  special_price: number | null;
  special_price_start_time: string | null;
  special_price_end_time: string | null;
  special_price_days: number[] | null;
  auto_disable_on_out_of_stock: boolean;
  station: 'kitchen' | 'bar' | 'other';
  created_at: string;
  updated_at: string;
  linked_ingredient_ids: string[];
  location_stock_quantity: number | null;
  low_stock_warning: boolean;
  out_of_stock_warning: boolean;
}

/**
 * Helper to calculate the current active price of a service item
 * accounts for Happy Hour / Special Pricing rules
 */
export function getActiveServicePrice(item: ServiceMenuItem): number {
  if (!item.special_price) return item.selling_price;

  const now = new Date();
  const currentDay = now.getDay() === 0 ? 7 : now.getDay(); // 1=Mon, 7=Sun
  
  // Check if today is a special price day
  if (item.special_price_days && !item.special_price_days.includes(currentDay)) {
    return item.selling_price;
  }

  // Check if current time is within special price window
  if (item.special_price_start_time && item.special_price_end_time) {
    const [startH, startM] = item.special_price_start_time.split(':').map(Number);
    const [endH, endM] = item.special_price_end_time.split(':').map(Number);
    
    const startTime = new Date(now);
    startTime.setHours(startH, startM, 0, 0);
    
    const endTime = new Date(now);
    endTime.setHours(endH, endM, 0, 0);

    // Handle cross-midnight windows (e.g., 10 PM to 2 AM)
    if (endTime < startTime) {
      if (now >= startTime || now <= endTime) {
        return item.special_price;
      }
    } else {
      if (now >= startTime && now <= endTime) {
        return item.special_price;
      }
    }
  }

  return item.selling_price;
}

/**
 * Helper to identify items with low stock
 */
export function isLowStock(item: ServiceMenuItem): boolean {
  if (!item.track_stock) return false;
  return item.low_stock_warning;
}

/**
 * Helper to check if an item is completely out of stock
 */
export function isOutOfStock(item: ServiceMenuItem): boolean {
  if (!item.track_stock) return false;
  return item.out_of_stock_warning;
}

export interface ServiceItemRecipe {
  id: string;
  service_item_id: string;
  ingredient_id: string | null;
  quantity_required: number;
  unit: string;
  is_extra: boolean;
  created_at: string;
  updated_at: string;
  ingredient?: {
    id?: string;
    name: string;
    purchase_price: number;
    stock_quantity: number;
    unit?: string;
  };
}

export interface HotelIngredient {
  id: string;
  name: string;
  description: string | null;
  purchase_price: number;
  stock_quantity: number;
  min_stock_threshold: number;
  unit: string;
  category: string;
  is_liquid: boolean;
  volume_per_unit: number;
  open_unit_volume: number;
  track_empties: boolean;
  empty_units_count: number;
  created_at: string;
  updated_at: string;
}

export interface HotelIngredientMovement {
  id: string;
  ingredient_id: string;
  movement_type: 'in' | 'out' | 'adjustment';
  quantity: number;
  reason: string;
  reference_id: string | null;
  notes: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  created_at: string;
  ingredient?: {
    id: string;
    name: string;
    unit: string;
    category: string;
  };
}

export interface WastageLog {
  id: string;
  ingredient_id: string | null;
  service_item_id: string | null;
  quantity: number;
  reason: 'expired' | 'spoiled' | 'prep_error' | 'over_used' | 'other';
  reported_by?: string;
  notes: string | null;
  created_at: string;
  ingredient?: { name: string };
  service_item?: { name: string };
}

type ServiceMenuRow = Omit<
  ServiceMenuItem,
  'linked_ingredient_ids' | 'location_stock_quantity' | 'low_stock_warning' | 'out_of_stock_warning'
>;

type ServiceRecipeLinkRow = {
  service_item_id: string;
  ingredient_id: string | null;
};

type InventoryLocationRow = {
  ingredient_id: string;
  location_code: 'main_store' | 'kitchen' | 'bar';
  quantity: number;
};

export interface ServiceItemRecipeInput {
  ingredient_id: string;
  quantity_required: number;
  unit: string;
  is_extra?: boolean;
}

export type ServiceMenuInsert = Pick<
  ServiceMenuRow,
  | 'name'
  | 'description'
  | 'category'
  | 'selling_price'
  | 'purchase_price'
  | 'is_available'
  | 'sort_order'
  | 'track_stock'
  | 'stock_quantity'
  | 'min_stock_threshold'
  | 'inventory_source_location'
  | 'use_recipe'
  | 'direct_ingredient_id'
> &
  Partial<
    Pick<
      ServiceMenuRow,
      | 'special_price'
      | 'special_price_start_time'
      | 'special_price_end_time'
      | 'special_price_days'
      | 'auto_disable_on_out_of_stock'
      | 'station'
    >
  >;
export type ServiceMenuUpdate = Partial<ServiceMenuInsert>;

function toNumber(value: unknown, fallback = 0) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function hydrateServiceMenuItems(
  items: ServiceMenuRow[],
  recipeLinks: ServiceRecipeLinkRow[],
  locationRows: InventoryLocationRow[]
): ServiceMenuItem[] {
  const ingredientIdsByServiceItem = new Map<string, string[]>();
  const locationQuantityByIngredient = new Map<string, number>();

  recipeLinks.forEach((recipe) => {
    if (!recipe.ingredient_id) return;
    const current = ingredientIdsByServiceItem.get(recipe.service_item_id) || [];
    current.push(recipe.ingredient_id);
    ingredientIdsByServiceItem.set(recipe.service_item_id, current);
  });

  locationRows.forEach((row) => {
    locationQuantityByIngredient.set(`${row.ingredient_id}:${row.location_code}`, Number(row.quantity || 0));
  });

  return items.map((item) => {
    const normalizedItem = {
      ...item,
      selling_price: toNumber(item.selling_price),
      purchase_price: toNumber(item.purchase_price),
      sort_order: toNumber(item.sort_order),
      stock_quantity: toNumber(item.stock_quantity),
      min_stock_threshold: toNumber(item.min_stock_threshold),
    };
    const recipeIngredientIds = ingredientIdsByServiceItem.get(item.id) || [];
    const linkedIngredientIds = Array.from(
      new Set(
        normalizedItem.use_recipe
          ? recipeIngredientIds
          : normalizedItem.direct_ingredient_id
            ? [normalizedItem.direct_ingredient_id]
            : []
      )
    );

    const trackedLocationQuantities = linkedIngredientIds.map((ingredientId) =>
      Number(locationQuantityByIngredient.get(`${ingredientId}:${normalizedItem.inventory_source_location}`) ?? 0)
    );
    const hasTrackedLinks = Boolean(normalizedItem.track_stock && trackedLocationQuantities.length > 0);
    const minThreshold = Number(normalizedItem.min_stock_threshold || 0);

    return {
      ...normalizedItem,
      linked_ingredient_ids: linkedIngredientIds,
      location_stock_quantity: hasTrackedLinks ? Math.min(...trackedLocationQuantities) : null,
      low_stock_warning: hasTrackedLinks && trackedLocationQuantities.some((quantity) => quantity <= minThreshold),
      out_of_stock_warning: hasTrackedLinks && trackedLocationQuantities.some((quantity) => quantity <= 0),
    };
  });
}

async function fetchServiceMenuItems(availableOnly: boolean) {
  let itemsQuery = apiClient
    .from('hotel_service_menu')
    .select('*')
    .order('category')
    .order('sort_order');

  if (availableOnly) {
    itemsQuery = itemsQuery.eq('is_available', true);
  }

  const [{ data: items, error: itemsError }, { data: recipeLinks, error: recipeError }, { data: locationRows, error: locationError }] =
    await Promise.all([
      itemsQuery,
      apiClient
        .from('hotel_service_item_recipes')
        .select('service_item_id, ingredient_id'),
      apiClient
        .from('hotel_inventory_item_locations')
        .select('ingredient_id, location_code, quantity')
        .in('location_code', ['kitchen', 'bar']),
    ]);

  if (itemsError) throw itemsError;
  if (recipeError) throw recipeError;
  if (locationError) throw locationError;

  return hydrateServiceMenuItems(
    (items || []) as ServiceMenuRow[],
    (recipeLinks || []) as ServiceRecipeLinkRow[],
    (locationRows || []) as InventoryLocationRow[]
  );
}

export function useServiceMenu() {
  return useQuery({
    queryKey: ['service-menu'],
    queryFn: async () => fetchServiceMenuItems(false),
    staleTime: 60000, // 1 minute
  });
}

export function useAvailableServices() {
  return useQuery({
    queryKey: ['service-menu', 'available'],
    queryFn: async () => fetchServiceMenuItems(true),
    staleTime: 60000, // 1 minute
  });
}

export function useAddServiceMenuItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: ServiceMenuInsert) => {
      const { data, error } = await apiClient
        .from('hotel_service_menu')
        .insert([item])
        .select()
        .single();

      if (error) throw error;

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      toast.success('Service item added');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateServiceMenuItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ServiceMenuUpdate }) => {
      const { data, error } = await apiClient
        .from('hotel_service_menu')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      toast.success('Service item updated');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useDeleteServiceMenuItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient
        .from('hotel_service_menu')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      toast.success('Service item deleted');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useToggleServiceAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_available }: { id: string; is_available: boolean }) => {
      const { error } = await apiClient
        .from('hotel_service_menu')
        .update({ is_available, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useServiceItemRecipes(serviceItemId: string) {
  return useQuery({
    queryKey: ['service-item-recipes', serviceItemId],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_service_item_recipes')
        .select(`
          *,
          ingredient:hotel_ingredients(id, name, purchase_price, stock_quantity, unit)
        `)
        .eq('service_item_id', serviceItemId);
      
      if (error) throw error;
      return (data as ServiceItemRecipe[]).map((recipe) => ({
        ...recipe,
        quantity_required: toNumber(recipe.quantity_required),
        ingredient: recipe.ingredient
          ? {
              ...recipe.ingredient,
              purchase_price: toNumber(recipe.ingredient.purchase_price),
              stock_quantity: toNumber(recipe.ingredient.stock_quantity),
            }
          : undefined,
      }));
    },
    enabled: !!serviceItemId,
  });
}

export function useHotelIngredients() {
  return useQuery({
    queryKey: ['hotel-ingredients'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_ingredients')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return (data as HotelIngredient[]).map((ingredient) => ({
        ...ingredient,
        purchase_price: toNumber(ingredient.purchase_price),
        stock_quantity: toNumber(ingredient.stock_quantity),
        min_stock_threshold: toNumber(ingredient.min_stock_threshold),
        volume_per_unit: toNumber(ingredient.volume_per_unit, 1),
        open_unit_volume: toNumber(ingredient.open_unit_volume),
        empty_units_count: toNumber(ingredient.empty_units_count),
      }));
    },
  });
}

export function useHotelIngredientMovements(ingredientId?: string) {
  return useQuery({
    queryKey: ['hotel-ingredient-movements', ingredientId],
    queryFn: async () => {
      let query = apiClient
        .from('hotel_ingredient_movements')
        .select(`
          *,
          ingredient:hotel_ingredients(id, name, unit, category)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (ingredientId) {
        query = query.eq('ingredient_id', ingredientId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as HotelIngredientMovement[]).map((movement) => ({
        ...movement,
        quantity: toNumber(movement.quantity),
        unit_cost: movement.unit_cost === null ? null : toNumber(movement.unit_cost),
        total_cost: movement.total_cost === null ? null : toNumber(movement.total_cost),
      }));
    },
  });
}

export function useAddHotelIngredient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ingredient: Omit<HotelIngredient, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await apiClient
        .from('hotel_ingredients')
        .insert([ingredient])
        .select()
        .single();

      if (error) throw error;

      // Log initial stock if provided
      if (ingredient.stock_quantity > 0) {
        await apiClient
          .from('hotel_ingredient_movements')
          .insert([{
            ingredient_id: data.id,
            movement_type: 'in',
            quantity: ingredient.stock_quantity,
            reason: 'Initial stock',
            unit_cost: Number(ingredient.purchase_price || 0),
            total_cost: Number(ingredient.purchase_price || 0) * Number(ingredient.stock_quantity || 0),
          }]);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      toast.success('Ingredient added to stock');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateHotelIngredient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<HotelIngredient> }) => {
      const { data, error } = await apiClient
        .from('hotel_ingredients')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // If purchase price was updated, recalculate affected service items
      if (updates.purchase_price !== undefined) {
        const { data: affectedRecipes } = await apiClient
          .from('hotel_service_item_recipes')
          .select('service_item_id')
          .eq('ingredient_id', id);

        if (affectedRecipes && affectedRecipes.length > 0) {
          const serviceItemIds = [...new Set(affectedRecipes.map(r => r.service_item_id))];
          await Promise.all(serviceItemIds.map(sid => recalculateServiceItemCost(sid)));
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['service-item-recipes'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      toast.success('Ingredient updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteHotelIngredient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient
        .from('hotel_ingredients')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['service-item-recipes'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      toast.success('Ingredient deleted');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAddIngredientStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ingredientId, quantity, type, reason, purchasePrice }: { 
      ingredientId: string; 
      quantity: number; 
      type: 'in' | 'out' | 'adjustment';
      reason: string;
      purchasePrice?: number;
    }) => {
      // 1. Get current stock and price
      const { data: ingredient } = await apiClient
        .from('hotel_ingredients')
        .select('stock_quantity, purchase_price')
        .eq('id', ingredientId)
        .single();

      const currentStock = Number(ingredient?.stock_quantity || 0);
      const currentPrice = Number(ingredient?.purchase_price || 0);
      let newStock = currentStock;
      const effectivePrice = purchasePrice !== undefined ? purchasePrice : currentPrice;

      if (type === 'in') newStock = currentStock + quantity;
      else if (type === 'out') newStock = Math.max(0, currentStock - quantity);
      else if (type === 'adjustment') newStock = quantity;

      // 2. Update stock and price
      const updateData: any = { 
        stock_quantity: newStock, 
        updated_at: new Date().toISOString() 
      };

      if (purchasePrice !== undefined && type === 'in') {
        updateData.purchase_price = purchasePrice;
      }

      const { error: updateError } = await apiClient
        .from('hotel_ingredients')
        .update(updateData)
        .eq('id', ingredientId);

      if (updateError) throw updateError;

      // 3. Log movement with cost
      const { error: logError } = await apiClient
        .from('hotel_ingredient_movements')
        .insert([{
          ingredient_id: ingredientId,
          movement_type: type,
          quantity,
          reason,
          unit_cost: effectivePrice,
          total_cost: effectivePrice * quantity
        }]);

      if (logError) throw logError;

      // 4. If price changed, recalculate costs for all service items using this ingredient
      if (purchasePrice !== undefined && purchasePrice !== currentPrice) {
        const { data: affectedRecipes } = await apiClient
          .from('hotel_service_item_recipes')
          .select('service_item_id')
          .eq('ingredient_id', ingredientId);

        if (affectedRecipes && affectedRecipes.length > 0) {
          // Unique service item IDs
          const serviceItemIds = [...new Set(affectedRecipes.map(r => r.service_item_id))];
          await Promise.all(serviceItemIds.map(id => recalculateServiceItemCost(id)));
        }
      }

      return { newStock };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] }); // Invalidate menu to update costs if price changed
      toast.success('Ingredient stock adjusted');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAddRecipeIngredient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recipe: Omit<ServiceItemRecipe, 'id' | 'created_at' | 'updated_at' | 'ingredient'>) => {
      const { data, error } = await apiClient
        .from('hotel_service_item_recipes')
        .insert([recipe])
        .select()
        .single();

      if (error) throw error;

      // Recalculate total cost for the service item
      await recalculateServiceItemCost(recipe.service_item_id);

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['service-item-recipes', variables.service_item_id] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      toast.success('Ingredient added to recipe');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useSyncServiceItemRecipes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      serviceItemId,
      recipes,
    }: {
      serviceItemId: string;
      recipes: ServiceItemRecipeInput[];
    }) => {
      const normalizedRecipes = recipes
        .filter((recipe) => recipe.ingredient_id && Number(recipe.quantity_required) > 0)
        .map((recipe) => ({
          service_item_id: serviceItemId,
          ingredient_id: recipe.ingredient_id,
          quantity_required: Number(recipe.quantity_required),
          unit: recipe.unit,
          is_extra: Boolean(recipe.is_extra),
        }));

      const { error: deleteError } = await apiClient
        .from('hotel_service_item_recipes')
        .delete()
        .eq('service_item_id', serviceItemId);

      if (deleteError) throw deleteError;

      if (normalizedRecipes.length > 0) {
        const { error: insertError } = await apiClient
          .from('hotel_service_item_recipes')
          .insert(normalizedRecipes);

        if (insertError) throw insertError;
      }

      await recalculateServiceItemCost(serviceItemId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['service-item-recipes', variables.serviceItemId] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRemoveRecipeIngredient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, serviceItemId }: { id: string; serviceItemId: string }) => {
      const { error } = await apiClient
        .from('hotel_service_item_recipes')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Recalculate total cost for the service item
      await recalculateServiceItemCost(serviceItemId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['service-item-recipes', variables.serviceItemId] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      toast.success('Ingredient removed');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

async function recalculateServiceItemCost(serviceItemId: string) {
  // 1. Fetch all ingredients for this recipe
  const { data: recipes, error: recipeError } = await apiClient
    .from('hotel_service_item_recipes')
    .select(`
      quantity_required,
      ingredient:hotel_ingredients(purchase_price)
    `)
    .eq('service_item_id', serviceItemId);

  if (recipeError) return;

  // 2. Sum up costs
  const totalCost = (recipes || []).reduce((sum, r) => {
    const itemCost = r.ingredient?.purchase_price || 0;
    return sum + (Number(r.quantity_required) * Number(itemCost));
  }, 0);

  // 3. Update the service menu item
  await apiClient
    .from('hotel_service_menu')
    .update({ 
      purchase_price: totalCost,
      updated_at: new Date().toISOString() 
    })
    .eq('id', serviceItemId);
}

export function useAddWastageLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (wastage: Omit<WastageLog, 'id' | 'created_at'>) => {
      const { data, error } = await apiClient
        .from('hotel_wastage_log')
        .insert([wastage])
        .select()
        .single();

      if (error) throw error;

      if (wastage.ingredient_id) {
        const { data: ingredient } = await apiClient
          .from('hotel_ingredients')
          .select('stock_quantity, purchase_price')
          .eq('id', wastage.ingredient_id)
          .single();
        
        if (ingredient) {
          const newStock = Math.max(0, (Number(ingredient.stock_quantity) || 0) - wastage.quantity);
          await apiClient
            .from('hotel_ingredients')
            .update({ stock_quantity: newStock })
            .eq('id', wastage.ingredient_id);
          
          await apiClient.from('hotel_ingredient_movements').insert([{
            ingredient_id: wastage.ingredient_id,
            movement_type: 'out',
            quantity: wastage.quantity,
            reason: `Wastage: ${wastage.reason}`,
            notes: wastage.notes,
            unit_cost: Number(ingredient.purchase_price || 0),
            total_cost: Number(ingredient.purchase_price || 0) * Number(wastage.quantity || 0),
          }]);
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      queryClient.invalidateQueries({ queryKey: ['wastage-logs'] });
      toast.success('Wastage reported successfully');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useWastageLogs() {
  return useQuery({
    queryKey: ['wastage-logs'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_wastage_log')
        .select(`
          *,
          ingredient:hotel_ingredients(name),
          service_item:hotel_service_menu(name)
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as WastageLog[];
    },
  });
}
