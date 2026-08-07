import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { toast } from 'sonner';

function generateSKU(name: string, existingIngredients: any[] = []) {
  const prefix = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

  const existingSKUs = existingIngredients
    .map(i => i.sku)
    .filter(Boolean) as string[];

  let number = 1;
  while (true) {
    const sku = `${prefix}-${String(number).padStart(3, '0')}`;
    if (!existingSKUs.includes(sku)) {
      return sku;
    }
    number++;
  }
}

export type HotelInventoryMovementType = 'in' | 'out' | 'adjustment' | 'transfer';
export type HotelInventoryLocation = 'main_store' | 'kitchen' | 'bar';

export interface HotelInventoryIngredient {
  id: string;
  name: string;
  description: string | null;
  purchase_price: number;
  stock_quantity: number;
  min_stock_threshold: number;
  reorder_quantity: number;
  unit: string;
  category: string;
  sku: string | null;
  supplier_name: string | null;
  storage_area: string | null;
  is_liquid: boolean;
  volume_per_unit: number;
  open_unit_volume: number;
  track_empties: boolean;
  empty_units_count: number;
  is_active: boolean;
  bulk_unit?: string;
  bulk_to_base_quantity?: number;
  base_unit?: string;
  purchase_price_per_bulk_unit?: number;
  created_at: string;
  updated_at: string;
}

export interface HotelInventoryMovement {
  id: string;
  ingredient_id: string;
  movement_type: HotelInventoryMovementType;
  quantity: number;
  reason: string;
  reference_id: string | null;
  notes: string | null;
  unit_cost: number;
  total_cost: number;
  movement_scope: string;
  location_code: HotelInventoryLocation | null;
  from_location_code: HotelInventoryLocation | null;
  to_location_code: HotelInventoryLocation | null;
  service_item_id: string | null;
  order_item_id: string | null;
  station: 'kitchen' | 'bar' | 'other' | null;
  shift_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  ingredient?: {
    id: string;
    name: string;
    unit: string;
    category: string;
  };
  shift?: {
    id: string;
    shift_label: string;
    status: string;
  } | null;
  staff?: {
    id: string;
    first_name: string;
    last_name: string;
    role: string;
  } | null;
}

export interface HotelBarCrate {
  id: string;
  name: string;
  ingredient_id: string | null;
  capacity: number;
  full_crates_count: number;
  empty_crates_count: number;
  min_full_threshold: number;
  min_empty_threshold: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  ingredient?: {
    id: string;
    name: string;
    unit: string;
    category: string;
  } | null;
}

export interface HotelRecipeLinkSummary {
  service_item_id: string;
  ingredient_links: number;
  product_links: number;
}

export interface HotelInventoryIngredientInput {
  name: string;
  description?: string | null;
  purchase_price?: number;
  purchase_price_per_bulk_unit?: number;
  stock_quantity?: number;
  min_stock_threshold?: number;
  reorder_quantity?: number;
  unit?: string;
  bulk_unit?: string;
  bulk_to_base_quantity?: number;
  base_unit?: string;
  category?: string;
  sku?: string | null;
  supplier_name?: string | null;
  storage_area?: string | null;
  is_liquid?: boolean;
  volume_per_unit?: number;
  open_unit_volume?: number;
  track_empties?: boolean;
  empty_units_count?: number;
  is_active?: boolean;
}

export interface HotelBarCrateInput {
  name: string;
  ingredient_id?: string | null;
  capacity?: number;
  full_crates_count?: number;
  empty_crates_count?: number;
  min_full_threshold?: number;
  min_empty_threshold?: number;
  notes?: string | null;
  is_active?: boolean;
}

export interface RecordHotelInventoryMovementInput {
  ingredientId: string;
  movementType: HotelInventoryMovementType;
  quantity: number;
  reason: string;
  locationCode?: HotelInventoryLocation | null;
  fromLocationCode?: HotelInventoryLocation | null;
  toLocationCode?: HotelInventoryLocation | null;
  movementScope?: 'manual' | 'purchase' | 'transfer' | 'menu' | 'waste' | 'adjustment' | 'return';
  notes?: string | null;
  unitCost?: number | null;
  referenceId?: string | null;
  shiftId?: string | null;
  createdBy?: string | null;
}

export interface HotelInventoryDailySnapshot {
  id: string;
  ingredient_id: string;
  location_code: HotelInventoryLocation;
  snapshot_date: string;
  opening_quantity: number;
  created_at: string;
  updated_at: string;
}

function normalizeQuantity(value?: number | null, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBulkToBaseQuantity(ingredient: Pick<HotelInventoryIngredientInput, 'bulk_to_base_quantity'>) {
  const quantity = normalizeQuantity(ingredient.bulk_to_base_quantity, 1);
  return quantity > 0 ? quantity : 1;
}

function getBaseUnit(ingredient: Pick<HotelInventoryIngredientInput, 'base_unit' | 'unit'>) {
  return (ingredient.base_unit || ingredient.unit || 'pcs').trim() || 'pcs';
}

function getBulkUnit(
  ingredient: Pick<HotelInventoryIngredientInput, 'bulk_unit' | 'base_unit' | 'unit'>
) {
  return (ingredient.bulk_unit || ingredient.base_unit || ingredient.unit || 'pcs').trim() || 'pcs';
}

function getPurchasePricePerBulkUnit(
  ingredient: Pick<HotelInventoryIngredientInput, 'purchase_price' | 'purchase_price_per_bulk_unit'>
) {
  return normalizeQuantity(
    ingredient.purchase_price_per_bulk_unit ?? ingredient.purchase_price,
    0
  );
}

function getCostPerBaseUnit(
  ingredient: Pick<
    HotelInventoryIngredientInput,
    'purchase_price' | 'purchase_price_per_bulk_unit' | 'bulk_to_base_quantity'
  >
) {
  const bulkToBaseQuantity = getBulkToBaseQuantity(ingredient);
  const purchasePricePerBulkUnit = getPurchasePricePerBulkUnit(ingredient);
  return purchasePricePerBulkUnit / bulkToBaseQuantity;
}

async function toPromise<T>(builder: any): Promise<T> {
  const result = await Promise.resolve(builder.execute ? builder.execute() : builder);
  return result as T;
}

export interface HotelInventoryLocationStock {
  id: string;
  ingredient_id: string;
  location_code: 'main_store' | 'kitchen' | 'bar';
  quantity: number;
  open_unit_volume: number;
  empty_units_count: number;
  min_stock_threshold: number;
}

export function useHotelInventoryIngredients() {
  return useQuery({
    queryKey: ['hotel-ingredients'],
    queryFn: async () => {
      const builder = apiClient.from('hotel_ingredients').select('*').order('is_active', { ascending: false }).order('name');
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;
      return (data || []) as HotelInventoryIngredient[];
    },
  });
}

export function useHotelInventoryLocations() {
  return useQuery({
    queryKey: ['hotel-inventory-locations'],
    queryFn: async () => {
      const builder = apiClient.from('hotel_inventory_item_locations').select('*');
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;
      return (data || []) as HotelInventoryLocationStock[];
    },
  });
}

export function useHotelInventoryDailySnapshots(locationCode?: HotelInventoryLocation | null) {
  return useQuery({
    queryKey: ['hotel-inventory-daily-snapshots', locationCode ?? 'all'],
    queryFn: async () => {
      let query = apiClient
        .from('hotel_inventory_daily_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (locationCode) {
        query = query.eq('location_code', locationCode);
      }

      const builder = query.limit(500);
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;
      return (data || []) as HotelInventoryDailySnapshot[];
    },
  });
}

export function useHotelInventoryMovements() {
  return useQuery({
    queryKey: ['hotel-ingredient-movements'],
    queryFn: async () => {
      const builder = apiClient
        .from('hotel_ingredient_movements')
        .select(`
            *,
            ingredient:hotel_ingredients(id, name, unit, category),
            shift:hotel_staff_shifts(id, shift_label, status),
            staff:hotel_staff(id, first_name, last_name, role)
          `)
          .order('created_at', { ascending: false })
          .limit(200);
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;
      return (data || []) as HotelInventoryMovement[];
    },
  });
}

export function useHotelBarCrates() {
  return useQuery({
    queryKey: ['hotel-bar-crates'],
    queryFn: async () => {
      const builder = apiClient
        .from('hotel_bar_crates')
        .select(`
            *,
            ingredient:hotel_ingredients(id, name, unit, category)
          `)
          .order('is_active', { ascending: false })
          .order('name');
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;
      return (data || []) as HotelBarCrate[];
    },
  });
}

export function useHotelRecipeLinkSummary() {
  return useQuery({
    queryKey: ['hotel-recipe-link-summary'],
    queryFn: async () => {
      const builder = apiClient
        .from('hotel_service_item_recipes')
        .select('service_item_id, ingredient_id, product_id');
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;

      const summary = new Map<string, HotelRecipeLinkSummary>();

      (data || []).forEach((row) => {
        const current = summary.get(row.service_item_id) || {
          service_item_id: row.service_item_id,
          ingredient_links: 0,
          product_links: 0,
        };

        if (row.ingredient_id) current.ingredient_links += 1;
        if (row.product_id) current.product_links += 1;

        summary.set(row.service_item_id, current);
      });

      return Array.from(summary.values());
    },
  });
}

export function useAddHotelInventoryIngredient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ingredient: HotelInventoryIngredientInput) => {
      const bulkToBaseQuantity = getBulkToBaseQuantity(ingredient);
      const baseUnit = getBaseUnit(ingredient);
      const bulkUnit = getBulkUnit(ingredient);
      const purchasePricePerBulkUnit = getPurchasePricePerBulkUnit(ingredient);
      const purchasePricePerBaseUnit = getCostPerBaseUnit(ingredient);
      const initialStockInBulkUnits = normalizeQuantity(ingredient.stock_quantity, 0);
      const initialStockInBaseUnits = initialStockInBulkUnits * bulkToBaseQuantity;
      const targetLocation = (ingredient.category || 'main_store') as HotelInventoryLocation;

      const payload = {
        name: ingredient.name,
        description: ingredient.description ?? null,
        purchase_price: purchasePricePerBaseUnit,
        purchase_price_per_bulk_unit: purchasePricePerBulkUnit,
        stock_quantity: initialStockInBaseUnits,
        min_stock_threshold: Number(ingredient.min_stock_threshold || 0),
        reorder_quantity: Number(ingredient.reorder_quantity || 0),
        unit: baseUnit,
        bulk_unit: bulkUnit,
        bulk_to_base_quantity: bulkToBaseQuantity,
        base_unit: baseUnit,
        category: targetLocation,
        sku: ingredient.sku ?? null,
        supplier_name: ingredient.supplier_name ?? null,
        storage_area: ingredient.storage_area ?? null,
        is_liquid: Boolean(ingredient.is_liquid),
        volume_per_unit: Number(ingredient.volume_per_unit || 1),
        open_unit_volume: Number(ingredient.open_unit_volume || 0),
        track_empties: Boolean(ingredient.track_empties),
        empty_units_count: Number(ingredient.empty_units_count || 0),
        is_active: ingredient.is_active ?? true,
      };

      const builder = apiClient.from('hotel_ingredients').insert([payload] as any).select().single();
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;

      if (initialStockInBaseUnits > 0) {
        const builder2 = apiClient.rpc('record_hotel_inventory_movement' as any, {
            p_ingredient_id: data.id,
            p_movement_type: 'in',
            p_quantity: initialStockInBaseUnits,
            p_reason: 'Initial stock',
            p_notes:
              bulkUnit === baseUnit
                ? 'Created with opening inventory balance'
                : `Created with opening inventory balance (${initialStockInBulkUnits} ${bulkUnit} = ${initialStockInBaseUnits} ${baseUnit})`,
            p_unit_cost: purchasePricePerBaseUnit,
            p_reference_id: null,
            p_shift_id: null,
            p_created_by: null,
          p_location_code: targetLocation,
        });
        const { error: movementError } = await toPromise<any>(builder2);

        if (movementError) throw movementError;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-locations'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-daily-snapshots'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      toast.success('Inventory item added');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateHotelInventoryIngredient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: HotelInventoryIngredientInput }) => {
      const bulkToBaseQuantity = getBulkToBaseQuantity(updates);
      const baseUnit = getBaseUnit(updates);
      const bulkUnit = getBulkUnit(updates);
      const purchasePricePerBulkUnit = getPurchasePricePerBulkUnit(updates);
      const purchasePricePerBaseUnit = getCostPerBaseUnit(updates);

      const payload = {
        name: updates.name,
        description: updates.description ?? null,
        purchase_price: purchasePricePerBaseUnit,
        purchase_price_per_bulk_unit: purchasePricePerBulkUnit,
        min_stock_threshold: Number(updates.min_stock_threshold || 0),
        reorder_quantity: Number(updates.reorder_quantity || 0),
        unit: baseUnit,
        bulk_unit: bulkUnit,
        bulk_to_base_quantity: bulkToBaseQuantity,
        base_unit: baseUnit,
        category: updates.category || 'main_store',
        sku: updates.sku ?? null,
        supplier_name: updates.supplier_name ?? null,
        storage_area: updates.storage_area ?? null,
        is_liquid: Boolean(updates.is_liquid),
        volume_per_unit: Number(updates.volume_per_unit || 1),
        open_unit_volume: Number(updates.open_unit_volume || 0),
        track_empties: Boolean(updates.track_empties),
        empty_units_count: Number(updates.empty_units_count || 0),
        is_active: updates.is_active ?? true,
        updated_at: new Date().toISOString(),
      };

      const builder = apiClient.from('hotel_ingredients').update(payload as any).eq('id', id).select().single();
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-locations'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-daily-snapshots'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      toast.success('Inventory item updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteHotelInventoryIngredient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const builder = apiClient.from('hotel_ingredients').delete().eq('id', id);
      const { error } = await toPromise<any>(builder);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-locations'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-daily-snapshots'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-bar-crates'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      toast.success('Inventory item deleted');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRecordHotelInventoryMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (movement: RecordHotelInventoryMovementInput) => {
      const quantityValue = Number(movement.quantity);
      const quantityPrimitive = Number.isFinite(quantityValue) ? quantityValue : Number(movement.quantity);

      const payload: Record<string, any> = {
        p_ingredient_id: movement.ingredientId,
        p_movement_type: movement.movementType,
        p_quantity: quantityPrimitive,
        p_reason: movement.reason,
        p_location_code: movement.locationCode ?? null,
        p_from_location_code: movement.fromLocationCode ?? movement.locationCode ?? null,
        p_to_location_code: movement.toLocationCode ?? movement.locationCode ?? null,
        p_movement_scope: movement.movementScope ?? null,
        p_notes: movement.notes ?? null,
        p_unit_cost: movement.unitCost ?? null,
        p_reference_id: movement.referenceId ?? null,
        p_shift_id: movement.shiftId ?? null,
        p_created_by: movement.createdBy ?? null,
      };

      const builder = apiClient.rpc('record_hotel_inventory_movement' as any, payload);
      const response = await toPromise<any>(builder);
      if (response?.error) {
        throw new Error(response.error.message || response.error.details || JSON.stringify(response.error));
      }
      return response?.data ?? response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-ingredient-movements'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-locations'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-daily-snapshots'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });

      const label =
        variables.movementType === 'in'
          ? 'Inventory restocked'
          : variables.movementType === 'out'
            ? 'Inventory deducted'
            : variables.movementType === 'transfer'
              ? 'Inventory transferred'
              : 'Inventory adjusted';

      toast.success(label);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRecordDailyOpeningStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ingredientIds,
      locationCode,
      snapshotDate,
    }: {
      ingredientIds: string[];
      locationCode: HotelInventoryLocation;
      snapshotDate?: string;
    }) => {
      const promises = ingredientIds.map(async (ingredientId) => {
        const builder = apiClient.rpc('record_daily_opening_stock' as any, {
          p_ingredient_id: ingredientId,
          p_location_code: locationCode,
          p_snapshot_date: snapshotDate ?? undefined,
        });
        const { error } = await toPromise<any>(builder);
        if (error) throw error;
      });

      await Promise.all(promises);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hotel-inventory-daily-snapshots'] });
      toast.success(
        `${variables.locationCode.replace('_', ' ')} opening stock snapshot recorded`
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAddHotelBarCrate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (crate: HotelBarCrateInput) => {
      const builder = apiClient
        .from('hotel_bar_crates')
        .insert([{
            name: crate.name,
            ingredient_id: crate.ingredient_id ?? null,
            capacity: Number(crate.capacity || 24),
            full_crates_count: Number(crate.full_crates_count || 0),
            empty_crates_count: Number(crate.empty_crates_count || 0),
            min_full_threshold: Number(crate.min_full_threshold || 0),
            min_empty_threshold: Number(crate.min_empty_threshold || 0),
            notes: crate.notes ?? null,
            is_active: crate.is_active ?? true,
          }] as any)
          .select()
          .single();
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-bar-crates'] });
      toast.success('Crate saved');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateHotelBarCrate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: HotelBarCrateInput }) => {
      const builder = apiClient
        .from('hotel_bar_crates')
        .update({
            name: updates.name,
            ingredient_id: updates.ingredient_id ?? null,
            capacity: Number(updates.capacity || 24),
            full_crates_count: Number(updates.full_crates_count || 0),
            empty_crates_count: Number(updates.empty_crates_count || 0),
            min_full_threshold: Number(updates.min_full_threshold || 0),
            min_empty_threshold: Number(updates.min_empty_threshold || 0),
            notes: updates.notes ?? null,
            is_active: updates.is_active ?? true,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', id)
          .select()
          .single();
      const { data, error } = await toPromise<any>(builder);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-bar-crates'] });
      toast.success('Crate updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteHotelBarCrate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const builder = apiClient
        .from('hotel_bar_crates')
        .delete()
        .eq('id', id);
      const { error } = await toPromise<any>(builder);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-bar-crates'] });
      toast.success('Crate deleted');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}