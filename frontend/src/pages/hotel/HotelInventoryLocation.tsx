import { useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Pencil, ArrowLeft, MinusCircle, ArrowRightLeft, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  useHotelInventoryIngredients,
  useAddHotelInventoryIngredient,
  useUpdateHotelInventoryIngredient,
  useDeleteHotelInventoryIngredient,
  useRecordHotelInventoryMovement,
  useHotelInventoryLocations,
  useRecordDailyOpeningStock,
  useHotelInventoryMovements,
  type HotelInventoryIngredient,
  type HotelInventoryIngredientInput,
} from '@/hooks/useHotelInventory';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { useParams, useNavigate } from 'react-router-dom';

type Location = 'main_store' | 'kitchen' | 'bar';

const UNIT_OPTIONS = ['pcs', 'kg', 'g', 'l', 'ml', 'bottle', 'crate', 'bag'];

const LOCATION_NAMES: Record<Location, string> = {
  main_store: 'Main Store',
  kitchen: 'Kitchen',
  bar: 'Bar',
};

function generateSKU(name: string, existingIngredients: HotelInventoryIngredient[] = []) {
  const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const existingSKUs = existingIngredients.map(i => i.sku).filter(Boolean) as string[];
  let number = 1;
  while (true) {
    const sku = `${prefix}-${String(number).padStart(3, '0')}`;
    if (!existingSKUs.includes(sku)) return sku;
    number++;
  }
}

function getBulkToBaseQuantity(product: Partial<HotelInventoryIngredientInput | HotelInventoryIngredient>) {
  const quantity = Number(product.bulk_to_base_quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getBaseUnit(product: Partial<HotelInventoryIngredientInput | HotelInventoryIngredient>) {
  return product.base_unit || product.unit || 'pcs';
}

function getBulkUnit(product: Partial<HotelInventoryIngredientInput | HotelInventoryIngredient>) {
  return product.bulk_unit || getBaseUnit(product);
}

function getPurchasePricePerBulkUnit(product: Partial<HotelInventoryIngredientInput | HotelInventoryIngredient>) {
  return Number(product.purchase_price_per_bulk_unit ?? product.purchase_price ?? 0);
}

function getCostPerBaseUnit(product: Partial<HotelInventoryIngredientInput | HotelInventoryIngredient>) {
  return getPurchasePricePerBulkUnit(product) / getBulkToBaseQuantity(product);
}

function formatQuantity(value: number | string) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  const normalized = Math.abs(num) >= 100 ? num.toFixed(1) : num.toFixed(3);
  return normalized.replace(/\.?0+$/, '');
}

const emptyProductForm: HotelInventoryIngredientInput = {
  name: '',
  purchase_price: 0,
  purchase_price_per_bulk_unit: 0,
  stock_quantity: 0,
  min_stock_threshold: 5,
  reorder_quantity: 0,
  unit: 'pcs',
  base_unit: 'pcs',
  bulk_unit: 'pcs',
  bulk_to_base_quantity: 1,
  category: 'main_store',
  sku: '',
  supplier_name: '',
  storage_area: '',
  is_liquid: false,
  volume_per_unit: 1,
  open_unit_volume: 0,
  track_empties: false,
  empty_units_count: 0,
  is_active: true,
};

export default function HotelInventoryLocation() {
  const { location } = useParams<{ location: Location }>();
  const navigate = useNavigate();
  const selectedLocation = (location as Location) || 'kitchen';
  const { formatCurrency } = useSettingsContext();

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<HotelInventoryIngredient | null>(null);
  const [productForm, setProductForm] = useState<HotelInventoryIngredientInput>(emptyProductForm);
  const [isSaving, setIsSaving] = useState(false);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [movementProduct, setMovementProduct] = useState<HotelInventoryIngredient | null>(null);
  const [movementType, setMovementType] = useState<'in' | 'out' | 'transfer'>('out');
  const [movementQuantity, setMovementQuantity] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [transferToLocation, setTransferToLocation] = useState<Location | ''>('');

  // Transfer log filters
  const [logSearch, setLogSearch] = useState('');
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');
  const [logSortAsc, setLogSortAsc] = useState(true);
  const [showTransferLog, setShowTransferLog] = useState(false);

  const { data: ingredients = [], isLoading: ingredientsLoading, refetch: refetchIngredients } = useHotelInventoryIngredients();
  const { data: inventoryLocations = [], refetch: refetchLocations } = useHotelInventoryLocations();
  const { data: movements = [] } = useHotelInventoryMovements();

  const addIngredient = useAddHotelInventoryIngredient();
  const updateIngredient = useUpdateHotelInventoryIngredient();
  const deleteIngredient = useDeleteHotelInventoryIngredient();
  const recordMovement = useRecordHotelInventoryMovement();
  const recordDailyOpeningStock = useRecordDailyOpeningStock();

  const getProductStockAtLocation = (productId: string, locationKey: string) => {
    const loc = inventoryLocations.find(l => l.ingredient_id === productId && l.location_code === locationKey);
    if (loc && Number.isFinite(Number(loc.quantity))) return Number(loc.quantity);

    // Main Store has no row of its own until its first transfer out — its
    // true balance is the ingredient's total. Kitchen/Bar must NOT fall
    // back to the total: no row there means nothing has been transferred
    // yet, so the correct stock is 0.
    if (locationKey === 'main_store') {
      const ingredient = ingredients.find(ing => ing.id === productId);
      const total = Number(ingredient?.stock_quantity || 0);
      return Number.isFinite(total) ? total : 0;
    }

    return 0;
  };

  const getProductMinStockAtLocation = (productId: string, locationKey: string) => {
    const loc = inventoryLocations.find(l => l.ingredient_id === productId && l.location_code === locationKey);
    return loc?.min_stock_threshold ?? 0;
  };

  const getProductsForLocation = (locationKey: Location) =>
    ingredients.filter(product => {
      const hasLocationRow = inventoryLocations.some(l => l.ingredient_id === product.id && l.location_code === locationKey);
      // Main Store shows products by category (where they were created)
      // even before any transfer row exists. Kitchen/Bar should only list
      // a product once it has actually been transferred there — category
      // alone must not qualify it, or every product "leaks" into every
      // location's table.
      if (locationKey === 'main_store') {
        return hasLocationRow || product.category === locationKey;
      }
      // Kitchen/Bar only show a product while it actually holds stock.
      // Once its transferred stock is used up (hits zero), it drops off
      // the list and stays off until Main Store transfers more in — the
      // row still exists at quantity 0, but it shouldn't clutter the
      // active list.
      if (!hasLocationRow) return false;
      return getProductStockAtLocation(product.id, locationKey) > 0;
    });

  const locationProducts = getProductsForLocation(selectedLocation);
  const locationIngredientIds = Array.from(
    new Set([
      ...locationProducts.map(product => product.id),
      ...inventoryLocations.filter(l => l.location_code === selectedLocation).map(l => l.ingredient_id),
    ])
  );

  const handleAddProduct = () => {
    setEditingProduct(null);
    setProductForm({ ...emptyProductForm, category: selectedLocation });
    setProductDialogOpen(true);
  };

  const handleEditProduct = (product: HotelInventoryIngredient) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      description: product.description ?? '',
      stock_quantity: product.stock_quantity,
      min_stock_threshold: product.min_stock_threshold,
      reorder_quantity: product.reorder_quantity,
      unit: product.base_unit || product.unit,
      base_unit: product.base_unit || product.unit,
      bulk_unit: product.bulk_unit || product.base_unit || product.unit,
      bulk_to_base_quantity: product.bulk_to_base_quantity || 1,
      category: product.category,
      sku: product.sku ?? '',
      supplier_name: product.supplier_name ?? '',
      storage_area: product.storage_area ?? '',
      is_liquid: product.is_liquid,
      volume_per_unit: product.volume_per_unit,
      open_unit_volume: product.open_unit_volume,
      track_empties: product.track_empties,
      empty_units_count: product.empty_units_count,
      is_active: product.is_active,
      purchase_price_per_bulk_unit: product.purchase_price_per_bulk_unit ?? product.purchase_price,
      purchase_price: product.purchase_price_per_bulk_unit ?? product.purchase_price,
    });
    setProductDialogOpen(true);
  };

  const handleSaveProduct = async () => {
    if (!productForm.name?.trim()) return;
    setIsSaving(true);
    try {
      const payload = { ...productForm, name: productForm.name.trim(), category: selectedLocation };
      if (editingProduct) {
        await updateIngredient.mutateAsync({ id: editingProduct.id, updates: payload });
      } else {
        await addIngredient.mutateAsync(payload);
      }
      setProductDialogOpen(false);
      setProductForm(emptyProductForm);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save product. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRecordOpeningSnapshot = async () => {
    if (locationIngredientIds.length === 0) return;
    await recordDailyOpeningStock.mutateAsync({
      ingredientIds: locationIngredientIds,
      locationCode: selectedLocation,
    });
  };

  const handleDeleteProduct = async (product: HotelInventoryIngredient) => {
    if (confirm(`Delete ${product.name}?`)) {
      await deleteIngredient.mutateAsync(product.id);
    }
  };

  const handleOpenMovementDialog = (product: HotelInventoryIngredient, type: 'in' | 'out' | 'transfer') => {
    setMovementProduct(product);
    setMovementType(type);
    setMovementQuantity('');
    setMovementReason('');
    setTransferToLocation('');
    setMovementDialogOpen(true);
  };

  const availableMovementTypes: ('in' | 'out' | 'transfer')[] = selectedLocation === 'main_store'
    ? ['in', 'out', 'transfer']
    : ['out', 'transfer'];

  // Transfer Log: filtered by this location, then by search text (product
  // name / movement id / reference id) and by an optional date range.
  const transferLogs = movements
    .filter(m => m.movement_type === 'transfer')
    .filter(m => m.from_location_code === selectedLocation || m.to_location_code === selectedLocation)
    .filter(m => {
      if (!logSearch.trim()) return true;
      const term = logSearch.trim().toLowerCase();
      return (
        (m.ingredient?.name || '').toLowerCase().includes(term) ||
        (m.id || '').toLowerCase().includes(term) ||
        (m.reference_id || '').toLowerCase().includes(term)
      );
    })
    .filter(m => {
      if (!logDateFrom) return true;
      return new Date(m.created_at) >= new Date(logDateFrom);
    })
    .filter(m => {
      if (!logDateTo) return true;
      const end = new Date(logDateTo);
      end.setHours(23, 59, 59, 999);
      return new Date(m.created_at) <= end;
    })
    .sort((a, b) =>
      logSortAsc
        ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const hasActiveLogFilters = Boolean(logSearch.trim() || logDateFrom || logDateTo);
  const visibleTransferLogs = hasActiveLogFilters ? transferLogs : transferLogs.slice(0, 20);

  const handleClearLogFilters = () => {
    setLogSearch('');
    setLogDateFrom('');
    setLogDateTo('');
  };

  const handleSaveMovement = async () => {
    if (!movementProduct) {
      alert('Please select a product');
      return;
    }

    const trimmedQuantity = (movementQuantity || '').trim();
    const enteredQuantity = Number(trimmedQuantity);
    if (!Number.isFinite(enteredQuantity) || enteredQuantity <= 0) {
      alert('Please enter a valid quantity');
      return;
    }

    if (movementType === 'transfer' && !transferToLocation) {
      alert('Please select a destination location');
      return;
    }

    // Never allow stock to go negative: for anything that draws down the
    // current location (Out, or Transfer/Return), the quantity can't
    // exceed what's actually on hand here.
    if (movementType === 'out' || movementType === 'transfer') {
      const availableStock = getProductStockAtLocation(movementProduct.id, selectedLocation);
      if (enteredQuantity > availableStock) {
        alert(
          `Only ${formatQuantity(availableStock)} ${getBaseUnit(movementProduct)} available at ${LOCATION_NAMES[selectedLocation]}. Enter ${formatQuantity(availableStock)} or less.`
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      const bulkUnit = getBulkUnit(movementProduct);
      const baseUnit = getBaseUnit(movementProduct);
      const bulkToBaseQuantity = getBulkToBaseQuantity(movementProduct);
      const quantityInBaseUnits = movementType === 'in' ? enteredQuantity * bulkToBaseQuantity : enteredQuantity;

      const payload: any = {
        ingredientId: movementProduct.id,
        quantity: quantityInBaseUnits,
        reason: movementReason || 'Stock transfer',
      };

      if (movementType === 'transfer') {
        payload.movementType = 'transfer';
        payload.fromLocationCode = selectedLocation;
        payload.toLocationCode = transferToLocation;
        payload.movementScope = 'transfer';
      } else {
        payload.movementType = movementType;
        payload.locationCode = selectedLocation;
        payload.movementScope = 'manual';
        payload.unitCost = movementType === 'in' ? getCostPerBaseUnit(movementProduct) : undefined;
        payload.notes =
          movementType === 'in' && bulkUnit !== baseUnit
            ? `Received ${formatQuantity(enteredQuantity)} ${bulkUnit} and converted to ${formatQuantity(quantityInBaseUnits)} ${baseUnit}`
            : null;
      }

      await recordMovement.mutateAsync(payload);
      setMovementDialogOpen(false);
      await Promise.all([refetchIngredients(), refetchLocations()]);
    } catch (error: any) {
      console.error('Movement failed:', error);
      alert(error?.message || 'Failed to record stock movement');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate('/restaurant/inventory')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-3xl font-bold">{LOCATION_NAMES[selectedLocation]} Inventory</h1>
          <Button
            variant="outline"
            onClick={handleRecordOpeningSnapshot}
            disabled={recordDailyOpeningStock.isPending || locationIngredientIds.length === 0}
          >
            {recordDailyOpeningStock.isPending ? 'Saving Snapshot...' : 'Snapshot Opening Stock'}
          </Button>
          <Button
            variant={showTransferLog ? 'secondary' : 'outline'}
            onClick={() => setShowTransferLog(current => !current)}
            className="ml-auto"
          >
            <Clock className="h-4 w-4 mr-2" />
            {showTransferLog ? 'Hide Transfer Log' : 'Transfer Log'}
          </Button>
          <Button onClick={handleAddProduct}>
            <Plus className="h-4 w-4 mr-2" />
            Add Product
          </Button>
        </div>

        {showTransferLog && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Transfer Log - {LOCATION_NAMES[selectedLocation]}
              </CardTitle>
              <div className="grid gap-3 md:grid-cols-5 items-end mt-4">
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs">Search (product name, ID, reference)</Label>
                  <Input
                    placeholder="e.g. rice, or a movement id"
                    value={logSearch}
                    onChange={event => setLogSearch(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">From date</Label>
                  <Input
                    type="date"
                    value={logDateFrom}
                    onChange={event => setLogDateFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To date</Label>
                  <Input
                    type="date"
                    value={logDateTo}
                    onChange={event => setLogDateTo(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sort by date</Label>
                  <select
                    value={logSortAsc ? 'asc' : 'desc'}
                    onChange={event => setLogSortAsc(event.target.value === 'asc')}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="asc">Earliest first</option>
                    <option value="desc">Latest first</option>
                  </select>
                </div>
              </div>
              {hasActiveLogFilters && (
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-muted-foreground">
                    Showing {transferLogs.length} matching {transferLogs.length === 1 ? 'entry' : 'entries'}
                  </p>
                  <Button variant="ghost" size="sm" onClick={handleClearLogFilters}>
                    Clear filters
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTransferLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No transfers found{hasActiveLogFilters ? ' for these filters' : ''}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleTransferLogs.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                        <TableCell>{m.ingredient?.name || '-'}</TableCell>
                        <TableCell className="capitalize">{m.movement_type}</TableCell>
                        <TableCell>{formatQuantity(m.quantity)}</TableCell>
                        <TableCell className="capitalize">{m.from_location_code || '-'}</TableCell>
                        <TableCell className="capitalize">{m.to_location_code || '-'}</TableCell>
                        <TableCell>{m.reason || m.notes || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-sm font-medium">Stock Model</p>
                <p className="text-sm text-muted-foreground">
                  {selectedLocation === 'main_store'
                    ? 'Record purchases here in bulk units. The app converts them into base units immediately.'
                    : `Use ${LOCATION_NAMES[selectedLocation]} as daily operational stock and refill it by transfer from Main Store.`}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">Daily Control</p>
                <p className="text-sm text-muted-foreground">
                  Save an opening snapshot each morning to compare expected closing stock against actual stock.
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">Recipe Engine</p>
                <p className="text-sm text-muted-foreground">
                  Recipes always deduct in base units like kg, g, L, or ml.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {ingredientsLoading ? (
              <p className="text-center py-8">Loading...</p>
            ) : locationProducts.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-4">No products yet</p>
                <Button onClick={handleAddProduct}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Product
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Unit Model</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Purchase Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locationProducts.map(product => {
                    const locationStock = getProductStockAtLocation(product.id, selectedLocation);
                    const minStockThreshold = getProductMinStockAtLocation(product.id, selectedLocation);
                    const baseUnit = getBaseUnit(product);
                    const bulkUnit = getBulkUnit(product);
                    const bulkToBaseQuantity = getBulkToBaseQuantity(product);
                    const isLow = locationStock <= minStockThreshold;
                    return (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="font-medium">{product.name}</div>
                          {product.supplier_name && (
                            <div className="text-xs text-muted-foreground">{product.supplier_name}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{product.sku || '-'}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div className="font-medium">{baseUnit}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatQuantity(bulkToBaseQuantity)} {baseUnit} / {bulkUnit}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{formatQuantity(locationStock)}</span>
                              <span className="text-muted-foreground">{baseUnit}</span>
                              {isLow && <Badge variant="destructive">Low</Badge>}
                            </div>
                            {bulkUnit !== baseUnit && (
                              <div className="text-xs text-muted-foreground">
                                Approx. {formatQuantity(locationStock / bulkToBaseQuantity)} {bulkUnit}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div>{formatCurrency(getPurchasePricePerBulkUnit(product))} / {bulkUnit}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatCurrency(getCostPerBaseUnit(product))} / {baseUnit}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={product.is_active ? 'secondary' : 'outline'}>
                            {product.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {availableMovementTypes.includes('in') && (
                              <Button variant="outline" size="sm" onClick={() => handleOpenMovementDialog(product, 'in')}>
                                <Plus className="h-4 w-4 mr-1" />
                                In
                              </Button>
                            )}
                            {availableMovementTypes.includes('out') && (
                              <Button variant="outline" size="sm" onClick={() => handleOpenMovementDialog(product, 'out')}>
                                <MinusCircle className="h-4 w-4 mr-1" />
                                Out
                              </Button>
                            )}
                            {availableMovementTypes.includes('transfer') && (
                              <Button variant="outline" size="sm" onClick={() => handleOpenMovementDialog(product, 'transfer')}>
                                <ArrowRightLeft className="h-4 w-4 mr-1" />
                                {selectedLocation === 'main_store' ? 'Transfer' : 'Return'}
                              </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => handleEditProduct(product)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDeleteProduct(product)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Edit Product' : 'Add Product'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Product Name</Label>
              <Input
                value={productForm.name || ''}
                onChange={event => {
                  const newName = event.target.value;
                  setProductForm(current => {
                    if (!editingProduct) {
                      const newSKU = newName.trim() ? generateSKU(newName, ingredients) : '';
                      return { ...current, name: newName, sku: newSKU };
                    }
                    return { ...current, name: newName };
                  });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input
                value={productForm.sku || ''}
                onChange={event => setProductForm(current => ({ ...current, sku: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Base Unit</Label>
              <select
                value={productForm.base_unit || productForm.unit || 'pcs'}
                onChange={event =>
                  setProductForm(current => ({
                    ...current,
                    unit: event.target.value,
                    base_unit: event.target.value,
                  }))
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {UNIT_OPTIONS.map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Bulk Unit</Label>
              <select
                value={productForm.bulk_unit || 'pcs'}
                onChange={event => setProductForm(current => ({ ...current, bulk_unit: event.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {UNIT_OPTIONS.map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Bulk to Base Qty</Label>
              <Input
                type="number"
                step="0.001"
                min="0.001"
                value={productForm.bulk_to_base_quantity || 1}
                onChange={event =>
                  setProductForm(current => ({
                    ...current,
                    bulk_to_base_quantity: Number(event.target.value || 1),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">Example: 1 bag = 25 kg, so enter 25.</p>
            </div>
            <div className="space-y-2">
              <Label>Purchase Price per Bulk Unit</Label>
              <Input
                type="number"
                step="0.01"
                value={productForm.purchase_price_per_bulk_unit ?? productForm.purchase_price ?? 0}
                onChange={event =>
                  setProductForm(current => ({
                    ...current,
                    purchase_price_per_bulk_unit: Number(event.target.value || 0),
                    purchase_price: Number(event.target.value || 0),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Opening Stock ({getBulkUnit(productForm)})</Label>
              <Input
                type="number"
                step="0.001"
                value={editingProduct ? editingProduct.stock_quantity : (productForm.stock_quantity || 0)}
                disabled={!!editingProduct}
                onChange={event =>
                  setProductForm(current => ({
                    ...current,
                    stock_quantity: Number(event.target.value || 0),
                  }))
                }
              />
              {editingProduct && <p className="text-xs text-muted-foreground">Use stock movements to change stock quantity</p>}
              {!editingProduct && <p className="text-xs text-muted-foreground">The app converts this into {getBaseUnit(productForm)} automatically.</p>}
            </div>
            <div className="space-y-2">
              <Label>Low Stock Threshold</Label>
              <Input
                type="number"
                step="0.001"
                value={productForm.min_stock_threshold || 0}
                onChange={event =>
                  setProductForm(current => ({
                    ...current,
                    min_stock_threshold: Number(event.target.value || 0),
                  }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Supplier</Label>
              <Input
                value={productForm.supplier_name || ''}
                onChange={event =>
                  setProductForm(current => ({
                    ...current,
                    supplier_name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Derived Cost</Label>
              <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                {formatCurrency(getCostPerBaseUnit(productForm))} per {getBaseUnit(productForm)}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveProduct} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Product'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={movementDialogOpen} onOpenChange={setMovementDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {movementType === 'in' ? 'Stock In' : movementType === 'out' ? 'Stock Out' : 'Stock Transfer'} - {movementProduct?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {movementType === 'transfer' && (
              <div className="space-y-2">
                <Label>{selectedLocation === 'main_store' ? 'Transfer To' : 'Return To Main Store'}</Label>
                <select
                  value={transferToLocation}
                  onChange={event => setTransferToLocation(event.target.value as Location)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Select destination</option>
                  {selectedLocation === 'main_store'
                    ? ['kitchen', 'bar'].map(loc => (
                        <option key={loc} value={loc}>{LOCATION_NAMES[loc as Location]}</option>
                      ))
                    : ['main_store'].map(loc => (
                        <option key={loc} value={loc}>{LOCATION_NAMES[loc as Location]}</option>
                      ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {selectedLocation === 'main_store'
                    ? 'Main stock can only be dispatched to Kitchen or Bar.'
                    : 'Kitchen and Bar can only return unused stock to Main Store.'}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                step="0.001"
                min="0.001"
                max={movementType !== 'in' && movementProduct ? getProductStockAtLocation(movementProduct.id, selectedLocation) : undefined}
                value={movementQuantity}
                onChange={event => setMovementQuantity(event.target.value)}
                placeholder={`Enter quantity in ${movementType === 'in' ? getBulkUnit(movementProduct || {}) : getBaseUnit(movementProduct || {})}`}
              />
              {movementType !== 'in' && movementProduct && (
                <p className="text-xs text-muted-foreground">
                  Available: {formatQuantity(getProductStockAtLocation(movementProduct.id, selectedLocation))} {getBaseUnit(movementProduct)}
                </p>
              )}
              {movementType === 'in' && movementProduct && (
                <p className="text-xs text-muted-foreground">
                  {formatQuantity(getBulkToBaseQuantity(movementProduct))} {getBaseUnit(movementProduct)} will be added for each {getBulkUnit(movementProduct)} received.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Reason / Note</Label>
              <Input
                value={movementReason}
                onChange={event => setMovementReason(event.target.value)}
                placeholder={movementType === 'in' ? 'e.g., Received from supplier' : movementType === 'out' ? 'e.g., Used for cooking' : 'e.g., Daily kitchen stock'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveMovement} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Movement'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </Layout>
  );
}