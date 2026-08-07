import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Search,
  Package,
  Settings2,
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  ClipboardList,
  Scale,
  AlertCircle,
  Trash,
  ThermometerSnowflake,
  Info,
  History,
  Calculator,
  ArrowRight,
  ChevronRight,
  Coins,
  Download,
  FileUp,
  FileSpreadsheet,
} from 'lucide-react';
import { 
  useServiceMenu, 
  useAddServiceMenuItem, 
  useUpdateServiceMenuItem, 
  useDeleteServiceMenuItem,
  useToggleServiceAvailability,
  useServiceItemRecipes,
  useAddRecipeIngredient,
  useRemoveRecipeIngredient,
  useAddWastageLog,
  useWastageLogs,
  useHotelIngredients,
  useAddHotelIngredient,
  useUpdateHotelIngredient,
  useDeleteHotelIngredient,
  useAddIngredientStock,
  useHotelIngredientMovements,
  ServiceMenuItem,
  ServiceItemRecipe,
  HotelIngredient,
} from '@/hooks/useServiceMenu';
import {
  useServiceCategories,
  useAddServiceCategory,
  useUpdateServiceCategory,
  useDeleteServiceCategory,
  useToggleCategoryActive,
  ServiceCategory,
} from '@/hooks/useServiceCategories';
import { useHotelInventoryLocations } from '@/hooks/useHotelInventory';
import { toast } from 'sonner';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { useActiveStaffShift } from '@/hooks/useHotelShifts';
import { exportToExcel, readExcelFile } from '@/lib/export';
import { apiClient } from '@/integrations/supabase/client';
import { ServiceCategoryVisual } from '@/components/hotel/ServiceCategoryVisual';
import {
  formatServiceCategoryLabel,
  inferServiceCategoryStation,
  inferServiceCategoryIcon,
  normalizeServiceCategoryName,
  normalizeLookupValue,
} from '@/lib/serviceCategoryUtils';
import { getStorageObjectPathFromPublicUrl, optimizeCoverImageFile } from '@/lib/imageUtils';
import {
  SERVICE_CATEGORY_ICON_OPTIONS,
  getServiceCategoryIconOption,
} from '@/lib/serviceCategoryVisuals';

const CATEGORY_IMAGE_BUCKET = 'category-images';
const CATEGORY_IMAGE_OFFSET_LIMIT = 40;

interface ServiceFormData {
  name: string;
  description: string;
  category: string;
  price: string;
  purchase_price: string;
  sort_order: string;
  is_available: boolean;
  track_stock: boolean;
  min_stock_threshold: string;
  inventory_source_location: '' | 'kitchen' | 'bar';
  use_recipe: boolean;
  direct_ingredient_id: string;
  stock_quantity: string;
}

const defaultFormData: ServiceFormData = {
  name: '',
  description: '',
  category: 'food',
  price: '',
  purchase_price: '',
  sort_order: '0',
  is_available: true,
  track_stock: false,
  min_stock_threshold: '5',
  inventory_source_location: 'kitchen',
  use_recipe: false,
  direct_ingredient_id: '',
  stock_quantity: '0',
};

interface EditableRecipeRow {
  id: string;
  ingredient_id: string;
  quantity_required: string;
  unit: string;
}

interface CategoryFormData {
  name: string;
  label: string;
  icon: string;
  image_url: string;
  station: 'kitchen' | 'bar' | 'other';
  sort_order: string;
}

const defaultCategoryForm: CategoryFormData = {
  name: '',
  label: '',
  icon: 'sparkles',
  image_url: '',
  station: 'kitchen',
  sort_order: '0',
};

const GlassCard = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white/40 backdrop-blur-xl border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.04)] rounded-[2rem] overflow-hidden", className)}>
    {children}
  </div>
);

const FuturisticBadge = ({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "success" | "warning" | "danger" }) => {
  const styles = {
    default: "bg-slate-100 text-slate-600 border-slate-200",
    success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]",
    warning: "bg-amber-500/10 text-amber-600 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.1)]",
    danger: "bg-rose-500/10 text-rose-600 border-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.1)]",
  };
  return (
    <Badge className={cn("px-2 py-0.5 text-[8px] font-black uppercase tracking-widest border rounded-md", styles[variant])}>
      {children}
    </Badge>
  );
};

export default function HotelServiceMenu() {
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [isWastageDialogOpen, setIsWastageDialogOpen] = useState(false);
  const [isIngredientDialogOpen, setIsIngredientDialogOpen] = useState(false);
  const [isIngredientStockDialogOpen, setIsIngredientStockDialogOpen] = useState(false);
  const [isRecipeDialogOpen, setIsRecipeDialogOpen] = useState(false);
  const [isStockDialogOpen, setIsStockDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ServiceMenuItem | null>(null);
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null);
  const [editingIngredient, setEditingIngredient] = useState<HotelIngredient | null>(null);
  const [wastageServiceItem, setWastageServiceItem] = useState<ServiceMenuItem | null>(null);
  const [recipeItem, setRecipeItem] = useState<ServiceMenuItem | null>(null);
  const [stockItem, setStockItem] = useState<ServiceMenuItem | null>(null);

  const handleOpenStockDialog = (item: ServiceMenuItem) => {
    setStockItem(item);
    setIsStockDialogOpen(true);
  };

  const resolvedStockItem = stockItem;
  const resolvedStockItemQuantity = stockItem?.stock_quantity || 0;

  const getProductStock = (productId: string) => {
    const item = menuItems.find(i => i.id === productId);
    return item?.stock_quantity || 0;
  };

  const handleStockSubmit = async () => {
  if (!stockItem || !stockMovement.quantity) return;

  const qty = parseFloat(stockMovement.quantity);
  if (isNaN(qty) || qty <= 0) {
    toast.error('Enter a valid quantity');
    return;
  }

  const currentStock = stockItem.stock_quantity || 0;
  let newStock: number;

  if (stockMovement.type === 'in') {
    newStock = currentStock + qty;
  } else if (stockMovement.type === 'out') {
    newStock = Math.max(0, currentStock - qty);
  } else {
    // adjustment = set absolute value
    newStock = qty;
  }

  const updates: Record<string, unknown> = { stock_quantity: newStock };

  // If stocking in with a new price, update purchase price too
  if (stockMovement.type === 'in' && stockMovement.purchasePrice) {
    const price = parseFloat(stockMovement.purchasePrice);
    if (!isNaN(price) && price > 0) {
      updates.purchase_price = price;
    }
  }

  try {
    await updateItem.mutateAsync({ id: stockItem.id, updates });
    toast.success(`Stock updated: ${currentStock} → ${newStock}`);
    setIsStockDialogOpen(false);
    setStockItem(null);
    setStockMovement({ type: 'in', quantity: '', reason: '', purchasePrice: '' });
  } catch (error) {
    toast.error('Failed to update stock');
  }
};

  const handleOpenRecipeDialog = useCallback((item: ServiceMenuItem) => {
    setRecipeItem(item);
    setIsRecipeDialogOpen(true);
  }, []);
  const [formData, setFormData] = useState<ServiceFormData>(defaultFormData);
  const [recipeRows, setRecipeRows] = useState<EditableRecipeRow[]>([]);
  const [categoryForm, setCategoryForm] = useState<CategoryFormData>(defaultCategoryForm);
  const categoryImageInputRef = useRef<HTMLInputElement | null>(null);
  const [categoryImageFile, setCategoryImageFile] = useState<File | null>(null);
  const [categoryImagePreview, setCategoryImagePreview] = useState<string | null>(null);
  const [isCategoryDropActive, setIsCategoryDropActive] = useState(false);
  const [isCategoryImageUploading, setIsCategoryImageUploading] = useState(false);
  const [categoryImageTransform, setCategoryImageTransform] = useState({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const selectedCategoryIcon = getServiceCategoryIconOption(categoryForm.icon);
  const categoryPreviewImage = categoryImagePreview || categoryForm.image_url || null;
  const hasLocalCategoryImage = Boolean(categoryImageFile && categoryImagePreview);
  const [ingredientForm, setIngredientForm] = useState({ 
    name: '', 
    description: '', 
    purchase_price: '', 
    stock_quantity: '0',
    min_stock_threshold: '5', 
    unit: 'pcs', 
    category: 'kitchen',
    is_liquid: false,
    volume_per_unit: '1',
    track_empties: false,
  });
  const [stockMovement, setStockMovement] = useState({ 
    type: 'in' as 'in' | 'out' | 'adjustment', 
    quantity: '', 
    reason: '',
    purchasePrice: ''
  });
  const [bulkRestock, setBulkRestock] = useState({ crates: '', perCrate: '24' });
  const [showBulkHelper, setShowBulkHelper] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('items');

  const { data: menuItems = [], isLoading } = useServiceMenu();
  const { data: categories = [], isLoading: categoriesLoading } = useServiceCategories();
  const { data: wastageLogs = [] } = useWastageLogs();
  const { data: ingredients = [] } = useHotelIngredients();
  const { data: ingredientMovements = [] } = useHotelIngredientMovements();
  const { data: inventoryLocations = [] } = useHotelInventoryLocations();
  const { formatCurrency } = useSettingsContext();
  const { activeStaff } = useStaffSession();
  const { data: activeShift } = useActiveStaffShift(activeStaff?.staff_id);
  const { data: editingItemRecipes = [] } = useServiceItemRecipes(editingItem?.id || '');
  const addItem = useAddServiceMenuItem();
  const updateItem = useUpdateServiceMenuItem();
  const deleteItem = useDeleteServiceMenuItem();
  const toggleAvailability = useToggleServiceAvailability();
  const addCategory = useAddServiceCategory();
  const updateCategory = useUpdateServiceCategory();
  const deleteCategory = useDeleteServiceCategory();
  const toggleCategoryActive = useToggleCategoryActive();
  const addIngredient = useAddHotelIngredient();
  const updateIngredient = useUpdateHotelIngredient();
  const deleteIngredient = useDeleteHotelIngredient();
  const addIngredientStock = useAddIngredientStock();

  const activeCategories = useMemo(() => 
    categories.filter(c => c.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [categories]
  );

  const visibleCategories = useMemo(() => {
    const categoryMap = new Map<string, ServiceCategory>();

    activeCategories.forEach((category) => {
      categoryMap.set(normalizeServiceCategoryName(category.name), category);
    });

    menuItems.forEach((item) => {
      const normalizedCategory = normalizeServiceCategoryName(item.category);
      if (!categoryMap.has(normalizedCategory)) {
        categoryMap.set(normalizedCategory, {
          id: `derived-${normalizedCategory}`,
          name: normalizedCategory,
          label: formatServiceCategoryLabel(item.category),
          icon: inferServiceCategoryIcon(item.category),
          image_url: null,
          station: inferServiceCategoryStation(item.category),
          sort_order: Number.MAX_SAFE_INTEGER,
          is_system: false,
          is_active: true,
          created_at: item.created_at,
          updated_at: item.updated_at,
        });
      }
    });

    return Array.from(categoryMap.values()).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  }, [activeCategories, menuItems]);

  const categoryItemCounts = useMemo(() => {
    return menuItems.reduce<Record<string, number>>((acc, item) => {
      const normalizedCategory = normalizeServiceCategoryName(item.category);
      acc[normalizedCategory] = (acc[normalizedCategory] || 0) + 1;
      return acc;
    }, {});
  }, [menuItems]);

  const summaryCategories = useMemo(() => {
    return [...visibleCategories]
      .filter((category) => (categoryItemCounts[normalizeServiceCategoryName(category.name)] || 0) > 0)
      .sort((a, b) => {
        const countDiff =
          (categoryItemCounts[normalizeServiceCategoryName(b.name)] || 0) -
          (categoryItemCounts[normalizeServiceCategoryName(a.name)] || 0);

        return countDiff || a.sort_order - b.sort_order || a.label.localeCompare(b.label);
      });
  }, [categoryItemCounts, visibleCategories]);

  const filteredItems = menuItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.description?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
    return matchesSearch;
  });

  const lowStockItems = useMemo(
    () => menuItems.filter((item) => item.low_stock_warning),
    [menuItems]
  );

  const canViewCostInsights = ['admin', 'manager', 'owner', 'accountant'].includes(activeStaff?.role || '');
  const selectedDirectIngredient = useMemo(
    () => ingredients.find((ingredient) => ingredient.id === formData.direct_ingredient_id) || null,
    [formData.direct_ingredient_id, ingredients]
  );
  const ingredientById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients]
  );
  const recipeEstimatedCost = useMemo(
    () =>
      recipeRows.reduce((sum, row) => {
        const ingredient = ingredientById.get(row.ingredient_id);
        return sum + (Number(row.quantity_required || 0) * Number(ingredient?.purchase_price || 0));
      }, 0),
    [ingredientById, recipeRows]
  );

  const currentSellingPrice = parseFloat(formData.price) || 0;
  const currentManualPurchasePrice = parseFloat(formData.purchase_price) || 0;
const currentEstimatedCost = formData.use_recipe
  ? recipeEstimatedCost
  : currentManualPurchasePrice || selectedDirectIngredient?.purchase_price || editingItem?.purchase_price || 0;
// Normalize to number to handle string values from API responses
const normalizedEstimatedCost = Number(currentEstimatedCost) || 0;
const currentEstimatedProfit = currentSellingPrice - normalizedEstimatedCost;
const currentEstimatedMargin = currentSellingPrice > 0
  ? (currentEstimatedProfit / currentSellingPrice) * 100
  : 0;

useEffect(() => {
    if (!isAddDialogOpen) return;

    if (!formData.use_recipe) {
      setRecipeRows([]);
      return;
    }

    if (editingItem) {
      setRecipeRows(
        editingItemRecipes.map((recipe) => ({
          id: recipe.id,
          ingredient_id: recipe.ingredient_id || '',
          quantity_required: recipe.quantity_required.toString(),
          unit: recipe.unit || ingredientById.get(recipe.ingredient_id || '')?.unit || 'pcs',
        }))
      );
      return;
    }

    if (recipeRows.length === 0) {
      setRecipeRows([{ id: crypto.randomUUID(), ingredient_id: '', quantity_required: '', unit: 'pcs' }]);
    }
  }, [editingItem, editingItemRecipes, formData.use_recipe, ingredientById, isAddDialogOpen]);

  const addRecipeRow = useCallback(() => {
    setRecipeRows((prev) => [...prev, { id: crypto.randomUUID(), ingredient_id: '', quantity_required: '', unit: 'pcs' }]);
  }, []);

  const updateRecipeRow = useCallback((rowId: string, updates: Partial<EditableRecipeRow>) => {
    setRecipeRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;

        const nextRow = { ...row, ...updates };
        if (updates.ingredient_id) {
          nextRow.unit = ingredientById.get(updates.ingredient_id)?.unit || nextRow.unit || 'pcs';
        }
        return nextRow;
      })
    );
  }, [ingredientById]);

  const removeRecipeRow = useCallback((rowId: string) => {
    setRecipeRows((prev) => prev.filter((row) => row.id !== rowId));
  }, []);

  const ensureServiceCategories = useCallback(async (rawCategories: Array<string | null | undefined>) => {
    const existingCategoryNames = new Set(categories.map((category) => normalizeServiceCategoryName(category.name)));
    const categoriesToCreate = new Map<string, {
      name: string;
      label: string;
      icon: string;
      station: 'kitchen' | 'bar' | 'other';
      sort_order: number;
    }>();

    rawCategories.forEach((rawCategory) => {
      const normalizedCategory = normalizeServiceCategoryName(rawCategory);

      if (!existingCategoryNames.has(normalizedCategory) && !categoriesToCreate.has(normalizedCategory)) {
        categoriesToCreate.set(normalizedCategory, {
          name: normalizedCategory,
          label: formatServiceCategoryLabel(rawCategory),
          icon: inferServiceCategoryIcon(rawCategory),
          station: inferServiceCategoryStation(rawCategory),
          sort_order: categories.length + categoriesToCreate.size,
        });
      }
    });

    if (categoriesToCreate.size === 0) {
      return 0;
    }

    const { error: categoryInsertError } = await apiClient
      .from('hotel_service_categories')
      .insert(Array.from(categoriesToCreate.values()).map((category) => ({
        ...category,
        is_active: true,
        is_system: false,
      })));

    if (categoryInsertError) {
      throw categoryInsertError;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['service-categories'] }),
      queryClient.invalidateQueries({ queryKey: ['service-categories', 'active'] }),
    ]);

    return categoriesToCreate.size;
  }, [categories, queryClient]);

  const handleOpenAdd = () => {
    setFormData({ ...defaultFormData, category: visibleCategories[0]?.name || 'other' });
    setRecipeRows([]);
    setEditingItem(null);
    setIsAddDialogOpen(true);
  };

  const resolveInventorySourceLocation = (item?: Partial<ServiceMenuItem> | null): 'kitchen' | 'bar' => {
    if (item?.inventory_source_location === 'kitchen' || item?.inventory_source_location === 'bar') {
      return item.inventory_source_location;
    }

    if (item?.station === 'bar') {
      return 'bar';
    }

    return inferServiceCategoryStation(item?.category) === 'bar' ? 'bar' : 'kitchen';
  };

  const handleOpenEdit = (item: ServiceMenuItem) => {
    setFormData({
      name: item.name,
      description: item.description || '',
      category: normalizeServiceCategoryName(item.category),
      price: item.selling_price.toString(),
      purchase_price: (item.purchase_price || 0).toString(),
      sort_order: item.sort_order.toString(),
      is_available: item.is_available,
      track_stock: item.track_stock,
      min_stock_threshold: item.min_stock_threshold.toString(),
      inventory_source_location: resolveInventorySourceLocation(item),
      use_recipe: item.use_recipe,
      direct_ingredient_id: item.direct_ingredient_id || '',
      stock_quantity: (item.stock_quantity || 0).toString(),
    });
    setRecipeRows([]);
    setEditingItem(item);
    setIsAddDialogOpen(true);
  };

  const handleSubmit = async () => {
    const trimmedName = formData.name.trim();
    const normalizedCategory = normalizeServiceCategoryName(formData.category);
    const resolvedSourceLocation =
      formData.inventory_source_location ||
      (inferServiceCategoryStation(normalizedCategory) === 'bar' ? 'bar' : 'kitchen');
    const sellingPrice = parseFloat(formData.price);
    const minStockThreshold = parseInt(formData.min_stock_threshold, 10) || 5;
    const sortOrder = parseInt(formData.sort_order, 10) || 0;
    const stockQuantity = parseFloat(formData.stock_quantity) || 0;

    if (!trimmedName || !formData.price || !resolvedSourceLocation) {
      toast.error('Name, price, and source location are required');
      return;
    }

if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
      toast.error('Enter a valid selling price');
      return;
    }

    // Use normalized value to handle string values from API responses
    if (!Number.isFinite(normalizedEstimatedCost) || normalizedEstimatedCost < 0) {
      toast.error('Enter a valid purchasing price');
      return;
    }
    
const data = {
      name: trimmedName,
      description: formData.description.trim() || null,
      category: normalizedCategory,
      selling_price: sellingPrice,
      purchase_price: normalizedEstimatedCost, // Use normalized value
      sort_order: sortOrder,
      is_available: formData.is_available,
      track_stock: formData.track_stock,
      min_stock_threshold: minStockThreshold,
      inventory_source_location: resolvedSourceLocation,
      use_recipe: formData.use_recipe,
      direct_ingredient_id: formData.use_recipe ? null : formData.direct_ingredient_id || null,
      // Only include stock_quantity when adding a new item.
      ...(!editingItem && { stock_quantity: stockQuantity }),
    };

    try {
      if (editingItem) {
        await updateItem.mutateAsync({ id: editingItem.id, updates: data });
      } else {
        await addItem.mutateAsync(data);
      }

      setIsAddDialogOpen(false);
      setFormData(defaultFormData);
      setRecipeRows([]);
      setEditingItem(null);
    } catch (error) {
      console.error('Failed to save service item:', error);
    }
  };

  const handleOpenCategoryAdd = () => {
    setIsCategoryDropActive(false);
    setCategoryImageTransform({ zoom: 1, offsetX: 0, offsetY: 0 });
    setCategoryImageFile(null);
    setCategoryImagePreview(null);
    setCategoryForm(defaultCategoryForm);
    setEditingCategory(null);
    setIsCategoryDialogOpen(true);
  };

  const handleOpenCategoryEdit = (cat: ServiceCategory) => {
    setIsCategoryDropActive(false);
    setCategoryImageTransform({ zoom: 1, offsetX: 0, offsetY: 0 });
    setCategoryImageFile(null);
    setCategoryImagePreview(null);
    setCategoryForm({
      name: cat.name,
      label: cat.label,
      icon: cat.icon || defaultCategoryForm.icon,
      image_url: cat.image_url || '',
      station: cat.station || defaultCategoryForm.station,
      sort_order: cat.sort_order.toString(),
    });
    setEditingCategory(cat);
    setIsCategoryDialogOpen(true);
  };

  const handleCategoryDialogChange = (open: boolean) => {
    setIsCategoryDialogOpen(open);

    if (!open) {
      setIsCategoryDropActive(false);
      setCategoryImageTransform({ zoom: 1, offsetX: 0, offsetY: 0 });
      setCategoryImageFile(null);
      setCategoryImagePreview(null);
      setCategoryForm(defaultCategoryForm);
      setEditingCategory(null);
    }
  };

  const applyCategoryImageFile = (file: File) => {
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Use JPG, PNG, or WebP images only');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Choose an image smaller than 5MB');
      return;
    }

    setCategoryImageFile(file);
    setCategoryImageTransform({ zoom: 1, offsetX: 0, offsetY: 0 });

    const reader = new FileReader();
    reader.onloadend = () => {
      setCategoryImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCategoryImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    applyCategoryImageFile(file as File);
  };

  const discardPendingCategoryImage = () => {
    setCategoryImageFile(null);
    setCategoryImagePreview(null);
    setCategoryImageTransform({ zoom: 1, offsetX: 0, offsetY: 0 });
    if (categoryImageInputRef.current) {
      categoryImageInputRef.current.value = '';
    }
  };

  const removeCategoryImageSelection = () => {
    discardPendingCategoryImage();
    setCategoryForm((current) => ({ ...current, image_url: '' }));
  };

  const handleCategoryImageDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsCategoryDropActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      applyCategoryImageFile(file);
    }
  };

  const handleCategoryImageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsCategoryDropActive(true);
  };

  const handleCategoryImageDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsCategoryDropActive(false);
  };

  const uploadCategoryImage = async (file: File) => {
    setIsCategoryImageUploading(true);

    try {
      const optimizedFile = await optimizeCoverImageFile(file, {
        size: 512,
        quality: 0.82,
        outputType: 'image/webp',
        zoom: categoryImageTransform.zoom,
        offsetX: categoryImageTransform.offsetX,
        offsetY: categoryImageTransform.offsetY,
      });
      const uniqueId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      const filePath = `categories/${uniqueId}.webp`;

      const { error: uploadError } = await apiClient.storage
        .from(CATEGORY_IMAGE_BUCKET)
        .upload(filePath, optimizedFile, {
          cacheControl: '31536000',
          contentType: optimizedFile.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data } = apiClient.storage
        .from(CATEGORY_IMAGE_BUCKET)
        .getPublicUrl(filePath);

      return data.publicUrl;
    } finally {
      setIsCategoryImageUploading(false);
    }
  };

  const removeCategoryImageFromStorage = async (imageUrl?: string | null) => {
    if (!imageUrl) return;

    const filePath = getStorageObjectPathFromPublicUrl(imageUrl, CATEGORY_IMAGE_BUCKET);
    if (!filePath) return;

    const { error } = await apiClient.storage
      .from(CATEGORY_IMAGE_BUCKET)
      .remove([filePath]);

    if (error) {
      console.error('Failed to delete category image:', error);
    }
  };

  const handleCategorySubmit = async () => {
    if (!categoryForm.name || !categoryForm.label) return;

    const previousImageUrl = editingCategory?.image_url || null;
    const currentImageUrl = categoryForm.image_url.trim() || null;
    let nextImageUrl = currentImageUrl;
    let uploadedImageUrl: string | null = null;

    try {
      if (categoryImageFile) {
        uploadedImageUrl = await uploadCategoryImage(categoryImageFile);
        nextImageUrl = uploadedImageUrl;
      }

      const data = {
        name: normalizeServiceCategoryName(categoryForm.name || categoryForm.label),
        label: categoryForm.label.trim(),
        icon: categoryForm.icon || defaultCategoryForm.icon,
        image_url: nextImageUrl,
        station: categoryForm.station,
        sort_order: parseInt(categoryForm.sort_order) || 0,
      };

      if (editingCategory) {
        await updateCategory.mutateAsync({ id: editingCategory.id, updates: data });
      } else {
        await addCategory.mutateAsync(data);
      }

      if (previousImageUrl && previousImageUrl !== nextImageUrl) {
        await removeCategoryImageFromStorage(previousImageUrl);
      }

      handleCategoryDialogChange(false);
    } catch (error) {
      if (uploadedImageUrl) {
        await removeCategoryImageFromStorage(uploadedImageUrl);
      }

      console.error('Failed to save category image:', error);
    }
  };

  const handleDeleteCategory = async (category: ServiceCategory) => {
    await deleteCategory.mutateAsync(category.id);

    if (category.image_url) {
      await removeCategoryImageFromStorage(category.image_url);
    }
  };

  const handleOpenWastageDialog = (serviceItem?: ServiceMenuItem) => {
    setWastageServiceItem(serviceItem || null);
    setIsWastageDialogOpen(true);
  };

  const handleExportExcel = () => {
    const data = menuItems.map(item => ({
      Name: item.name,
      Description: item.description || '',
      Category: item.category,
      'Purchasing Price': item.purchase_price,
      'Selling Price': item.selling_price,
      'Sort Order': item.sort_order,
      Available: item.is_available ? 'Yes' : 'No',
      'Track Stock': item.track_stock ? 'Yes' : 'No',
      'Min Stock Threshold': item.min_stock_threshold,
      'Source Location': item.inventory_source_location,
      'Use Recipe': item.use_recipe ? 'Yes' : 'No',
      'Direct Ingredient': item.direct_ingredient_id
        ? ingredientById.get(item.direct_ingredient_id)?.name || ''
        : '',
    }));
    exportToExcel(data, `hotel-menu-${new Date().toISOString().split('T')[0]}`, 'Menu Items');
    toast.success('Menu exported successfully');
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await readExcelFile(file);
      await ensureServiceCategories(data.map((row) => row.Category || row.category || 'food'));
      let importedCount = 0;
      let errorCount = 0;

      for (const row of data) {
        try {
          const normalizedCategory = normalizeServiceCategoryName(row.Category || row.category || 'food');
          const directIngredientName = String(
            row['Direct Ingredient'] || row.direct_ingredient || row.direct_ingredient_name || ''
          ).trim();
          const matchedIngredient = ingredients.find(
            (ingredient) => normalizeLookupValue(ingredient.name) === normalizeLookupValue(directIngredientName)
          );
          const sourceLocationRaw = String(
            row['Source Location'] || row.inventory_source_location || row.source_location || ''
          ).toLowerCase();
          const inventorySourceLocation = sourceLocationRaw === 'bar' ? 'bar' : 'kitchen';
          const useRecipe = String(row['Use Recipe'] || row.use_recipe || 'No').toLowerCase() === 'yes';
          const newItem = {
            name: row.Name || row.name,
            description: row.Description || row.description || null,
            category: normalizedCategory,
            purchase_price: parseFloat(row['Purchasing Price'] || row.purchase_price || 0),
            selling_price: parseFloat(row['Selling Price'] || row.Price || row.price || 0),
            sort_order: parseInt(row['Sort Order'] || row.sort_order || 0),
            is_available: (row.Available || row.available || 'Yes').toLowerCase() === 'yes',
            track_stock: (row['Track Stock'] || row.track_stock || 'No').toLowerCase() === 'yes',
            min_stock_threshold: parseInt(row['Min Stock Threshold'] || row.min_stock_threshold || 5),
            inventory_source_location: inventorySourceLocation,
            use_recipe: useRecipe,
            direct_ingredient_id: useRecipe ? null : matchedIngredient?.id || null,
          };

          if (newItem.name && newItem.selling_price >= 0) {
            await addItem.mutateAsync(newItem);
            importedCount++;
          }
        } catch (err) {
          errorCount++;
        }
      }

      toast.success(`Successfully imported ${importedCount} items. ${errorCount > 0 ? `${errorCount} errors.` : ''}`);
    } catch (err) {
      toast.error('Failed to read Excel file');
    } finally {
      e.target.value = '';
    }
  };

  // Group items by category for the dashboard
  const groupedItems = useMemo(() => {
    const grouped: Record<string, ServiceMenuItem[]> = {};
    visibleCategories.forEach(cat => {
      grouped[cat.name] = filteredItems.filter(
        item => normalizeServiceCategoryName(item.category) === normalizeServiceCategoryName(cat.name)
      );
    });
    return grouped;
  }, [visibleCategories, filteredItems]);

  return (
    <Layout>
      <div className="fixed inset-0 bg-[#f8fafc] cyber-grid z-0 opacity-40 pointer-events-none" />
      <div className="relative z-10 space-y-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary/70">System Administration</span>
            </div>
            <h1 className="text-4xl font-black tracking-tighter text-slate-900 uppercase leading-none">
              Service <span className="text-primary font-light">Inventory</span>
            </h1>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Database management for services, categories, and logistics
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <GlassCard className="flex items-center p-1.5 px-3 bg-white/60 border-white/80 shadow-sm">
              <div className="flex gap-1">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleExportExcel} 
                  className="h-9 px-3 rounded-xl hover:bg-primary/10 hover:text-primary font-black text-[9px] uppercase tracking-widest transition-all"
                >
                  <Download className="h-4 w-4 mr-2" />
                  EXPORT
                </Button>
                <div className="h-4 w-[1px] bg-slate-200 self-center mx-1" />
                <div className="relative">
                  <Input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleImportExcel}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-9 px-3 rounded-xl hover:bg-primary/10 hover:text-primary font-black text-[9px] uppercase tracking-widest transition-all"
                  >
                    <FileUp className="h-4 w-4 mr-2" />
                    IMPORT
                  </Button>
                </div>
              </div>
            </GlassCard>

            <Button 
              variant="outline" 
              onClick={handleOpenCategoryAdd}
              className="h-12 px-6 rounded-2xl border-slate-200 bg-white/60 hover:bg-primary/5 hover:border-primary/30 font-black text-[10px] uppercase tracking-widest transition-all shadow-sm"
            >
              <Settings2 className="h-4 w-4 mr-2" />
              NEW CATEGORY
            </Button>
            <Button 
              onClick={handleOpenAdd}
              className="h-12 px-8 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-[10px] uppercase tracking-widest transition-all shadow-[0_10px_30px_rgba(0,0,0,0.1)] active:scale-95"
            >
              <Plus className="h-4 w-4 mr-2" />
              ADD REGISTRY ITEM
            </Button>
          </div>
        </div>

        {/* Summary Statistics - Futuristic Dashboard */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
          <GlassCard className="group relative p-6 bg-primary text-white border-primary shadow-[0_20px_40px_rgba(var(--primary),0.2)] transition-transform hover:-translate-y-1 duration-500">
            <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:scale-110 transition-transform">
              <Package className="h-12 w-12" />
            </div>
            <div className="relative z-10">
              <p className="text-4xl font-black tracking-tighter mb-1 leading-none">{menuItems.length}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-80">TOTAL REGISTRY</p>
            </div>
          </GlassCard>

          {summaryCategories.slice(0, 5).map((cat) => {
            const count = categoryItemCounts[normalizeServiceCategoryName(cat.name)] || 0;
            return (
              <GlassCard key={cat.id} className="group p-6 bg-white/60 hover:bg-white hover:border-primary/20 transition-all duration-500 hover:-translate-y-1">
                <div className="flex items-center justify-between mb-4">
                  <ServiceCategoryVisual
                    imageUrl={cat.image_url}
                    iconName={cat.icon}
                    label={cat.label}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl ring-1 transition-all"
                    iconClassName="h-5 w-5"
                  />
                  <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                </div>
                <p className="text-3xl font-black tracking-tighter text-slate-900 mb-1 leading-none tabular-nums">{count}</p>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 truncate">{cat.label}</p>
              </GlassCard>
            );
          })}
        </div>

        {/* Low Stock Alert - Futuristic Warning */}
        {lowStockItems.length > 0 && (
          <div className="relative overflow-hidden p-6 rounded-[2rem] bg-rose-50 border-2 border-rose-100 shadow-[0_15px_40px_rgba(244,63,94,0.08)] animate-in slide-in-from-top duration-700">
            <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-3xl -mr-16 -mt-16" />
            <div className="relative z-10 flex items-center gap-6">
              <div className="h-14 w-14 rounded-2xl bg-rose-500 flex items-center justify-center shadow-lg shadow-rose-500/30 animate-pulse">
                <AlertTriangle className="h-7 w-7 text-white" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-black text-rose-900 uppercase tracking-widest mb-1">LOGISTICS ALERT: CRITICAL STOCK LEVELS</h4>
                <p className="text-xs font-bold text-rose-600 uppercase tracking-widest opacity-80">
                  {lowStockItems.map(i => i.name).join(', ')} REQUIRE IMMEDIATE REPLENISHMENT
                </p>
              </div>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="h-16 p-2 bg-slate-900/5 rounded-[2rem] border border-slate-100 backdrop-blur-md">
            <TabsTrigger 
              value="items" 
              className="h-12 px-8 rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-lg transition-all duration-500"
            >
              REGISTRY ITEMS
            </TabsTrigger>
            <TabsTrigger 
              value="categories" 
              className="h-12 px-8 rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-lg transition-all duration-500"
            >
              CATEGORIES
            </TabsTrigger>
            <TabsTrigger 
              value="ingredients" 
              className="h-12 px-8 rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-lg transition-all duration-500"
            >
              LOGISTICS
            </TabsTrigger>
            <TabsTrigger 
              value="wastage" 
              className="h-12 px-8 rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-lg transition-all duration-500"
            >
              WASTAGE DATA
            </TabsTrigger>
          </TabsList>

          {/* Items Tab */}
          <TabsContent value="items" className="mt-0 space-y-8 animate-in fade-in duration-700">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-md group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 flex items-center gap-3">
                  <Search className="h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                  <div className="h-4 w-[1px] bg-slate-200" />
                </div>
                <Input
                  placeholder="SEARCH REGISTRY BY NAME OR DESCRIPTION..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-14 pl-16 pr-6 rounded-2xl bg-white border-slate-100 focus:border-primary/30 focus:ring-0 text-xs font-black uppercase tracking-[0.2em] transition-all text-slate-900 shadow-sm"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="h-12 w-12 border-4 border-primary/10 border-t-primary rounded-full animate-spin" />
                <span className="text-[10px] font-black text-primary tracking-[0.5em] animate-pulse uppercase">Syncing Registry...</span>
              </div>
            ) : filteredItems.length === 0 ? (
              <GlassCard className="py-20 flex flex-col items-center justify-center bg-white/40">
                <div className="relative mb-6">
                  <Package className="h-16 w-16 text-slate-200" />
                  <div className="absolute inset-0 border-2 border-dashed border-slate-200 rounded-full animate-[spin_10s_linear_infinite]" />
                </div>
                <p className="text-sm font-black uppercase tracking-[0.3em] text-slate-400">Zero Registry Nodes Found</p>
              </GlassCard>
            ) : (
              <div className="space-y-12">
                {visibleCategories.map((cat) => {
                  const items = groupedItems[cat.name];
                  if (!items || items.length === 0) return null;
                  
                  return (
                    <div key={cat.name} className="space-y-6">
                      <div className="flex items-center gap-4 pl-2">
                        <ServiceCategoryVisual
                          imageUrl={cat.image_url}
                          iconName={cat.icon}
                          label={cat.label}
                          className="flex h-12 w-12 items-center justify-center rounded-2xl ring-1"
                          iconClassName="h-6 w-6"
                        />
                        <div className="flex flex-col">
                          <h2 className="text-2xl font-black tracking-tighter text-slate-900 uppercase leading-none">{cat.label}</h2>
                          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mt-1">{items.length} ACTIVE NODES</p>
                        </div>
                        <div className="flex-1 h-[1px] bg-gradient-to-r from-slate-200 to-transparent ml-4" />
                      </div>

                      <GlassCard className="bg-white/60 border-white/80 shadow-xl">
                        <ServiceTable
                          items={items}
                          onEdit={handleOpenEdit}
                          onDelete={(id) => deleteItem.mutateAsync(id)}
                          onToggle={(id, val) => toggleAvailability.mutateAsync({ id, is_available: !val })}
                          onStock={handleOpenStockDialog}
                          onRecipe={handleOpenRecipeDialog}
                          onWastage={handleOpenWastageDialog}
                          formatCurrency={formatCurrency}
                          getProductStock={getProductStock}
                        />
                      </GlassCard>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Categories Tab */}
          <TabsContent value="categories" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Service Categories</CardTitle>
              </CardHeader>
              <CardContent>
                {categoriesLoading ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <div className="min-w-[800px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Visual</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Label</TableHead>
                            <TableHead>Route</TableHead>
                            <TableHead className="text-center">Active</TableHead>
                            <TableHead className="text-center">System</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {categories.map((cat) => {
                            return (
                              <TableRow key={cat.id}>
                                <TableCell>
                                  <ServiceCategoryVisual
                                    imageUrl={cat.image_url}
                                    iconName={cat.icon}
                                    label={cat.label}
                                    className="flex h-10 w-10 items-center justify-center rounded-xl ring-1"
                                    iconClassName="h-5 w-5"
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-sm">{cat.name}</TableCell>
                                <TableCell className="font-medium">{cat.label}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="capitalize">
                                    {cat.station || inferServiceCategoryStation(cat.name)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Switch
                                    checked={cat.is_active}
                                    onCheckedChange={() => toggleCategoryActive.mutateAsync({ id: cat.id, is_active: !cat.is_active })}
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  {cat.is_system && <Badge variant="outline">System</Badge>}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleOpenCategoryEdit(cat)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    {!cat.is_system && (
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button variant="ghost" size="icon">
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Delete Category</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              Are you sure? Items in this category will need to be reassigned.
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDeleteCategory(cat)}>
                                              Delete
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Ingredients Tab */}
          <TabsContent value="ingredients" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Hotel Ingredients</CardTitle>
                  <p className="text-sm text-muted-foreground">Kitchen-only stock (not shared with POS)</p>
                </div>
                <Button onClick={() => {
                  setEditingIngredient(null);
                  setIngredientForm({ 
                    name: '', 
                    description: '', 
                    purchase_price: '', 
                    stock_quantity: '0',
                    min_stock_threshold: '5', 
                    unit: 'pcs', 
                    category: 'kitchen',
                    is_liquid: false,
                    volume_per_unit: '1',
                    track_empties: false,
                  });
                  setIsIngredientDialogOpen(true);
                }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Ingredient
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-center">Stock</TableHead>
                      <TableHead className="text-center">Unit</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ingredients.map((ing) => (
                      <TableRow key={ing.id}>
                        <TableCell className="font-medium">{ing.name}</TableCell>
                        <TableCell className="capitalize">{ing.category}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(ing.purchase_price)}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <Badge 
                              variant={ing.stock_quantity <= ing.min_stock_threshold ? 'destructive' : 'secondary'}
                              className="cursor-pointer"
                              onClick={() => {
                                setEditingIngredient(ing);
                                setStockMovement({ type: 'in', quantity: '', reason: '', purchasePrice: ing.purchase_price.toString() });
                                setIsIngredientStockDialogOpen(true);
                              }}
                            >
                              {ing.stock_quantity}
                            </Badge>
                            {ing.is_liquid && (
                              <div 
                                className="flex items-center gap-1 text-[10px] text-primary cursor-pointer hover:underline"
                                onClick={() => {
                                  setEditingIngredient(ing);
                                  setStockMovement({ 
                                    type: 'adjustment', 
                                    quantity: ing.stock_quantity.toString(), 
                                    reason: 'Volume Audit', 
                                    purchasePrice: ing.purchase_price.toString() 
                                  });
                                  setIsIngredientStockDialogOpen(true);
                                }}
                              >
                                <ThermometerSnowflake className="h-2 w-2" />
                                {ing.open_unit_volume}ml open
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">{ing.unit}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => {
                                setEditingIngredient(ing);
                                setIngredientForm({
                                  name: ing.name,
                                  description: ing.description || '',
                                  purchase_price: ing.purchase_price.toString(),
                                  min_stock_threshold: ing.min_stock_threshold.toString(),
                                  unit: ing.unit,
                                  category: ing.category,
                                  is_liquid: ing.is_liquid,
                                  volume_per_unit: ing.volume_per_unit.toString(),
                                  track_empties: ing.track_empties,
                                  stock_quantity: '0', // Not used in edit
                                });
                                setIsIngredientDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Ingredient</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure? Any recipes using this ingredient will be affected.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction 
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => deleteIngredient.mutateAsync(ing.id)}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  Ingredient Stock Ledger
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ingredientMovements.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">No ingredient stock records yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Ingredient</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead className="text-right">Total Cost</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ingredientMovements.slice(0, 50).map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell className="text-muted-foreground">
                            {new Date(movement.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="font-medium">
                            {movement.ingredient?.name || 'Unknown ingredient'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={movement.movement_type === 'in' ? 'default' : movement.movement_type === 'out' ? 'destructive' : 'secondary'}>
                              {movement.movement_type === 'in' && <TrendingUp className="mr-1 h-3 w-3" />}
                              {movement.movement_type === 'out' && <TrendingDown className="mr-1 h-3 w-3" />}
                              {movement.movement_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.movement_type === 'in' ? '+' : movement.movement_type === 'out' ? '-' : ''}
                            {movement.quantity} {movement.ingredient?.unit || ''}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.unit_cost !== null && movement.unit_cost !== undefined ? formatCurrency(movement.unit_cost) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.total_cost !== null && movement.total_cost !== undefined ? formatCurrency(movement.total_cost) : '-'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{movement.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Wastage History Tab */}
          <TabsContent value="wastage" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ThermometerSnowflake className="h-5 w-5 text-destructive" />
                  Wastage & Loss History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {wastageLogs.length === 0 ? (
                  <div className="text-center py-12 border rounded-lg bg-muted/20">
                    <History className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">No wastage reports found</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Ingredient / Product</TableHead>
                        <TableHead>Service Item</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wastageLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-medium">
                            {log.ingredient?.name || 'Unknown Item'}
                          </TableCell>
                          <TableCell>
                            {log.service_item?.name || <span className="text-muted-foreground text-xs">Direct Loss</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {log.reason.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-destructive">
                            -{log.quantity}
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-muted-foreground italic">
                            {log.notes || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Add/Edit Item Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingItem ? 'Edit Service Item' : 'Add Service Item'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Continental Breakfast"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  rows={2}
                />
              </div>

              {/* Inventory Source Location */}
              <div className="space-y-2">
                <Label htmlFor="inventory_source_location">Source Location</Label>
                <Select
                  value={formData.inventory_source_location}
                  onValueChange={(value: 'kitchen' | 'bar') =>
                    setFormData({ ...formData, inventory_source_location: value })
                  }
                >
                  <SelectTrigger id="inventory_source_location">
                    <SelectValue placeholder="Choose location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kitchen">Kitchen</SelectItem>
                    <SelectItem value="bar">Bar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Use Recipe Switch */}
              <div className="flex items-center space-x-2">
                <Switch
                  id="use_recipe"
                  checked={formData.use_recipe}
                  onCheckedChange={(checked) => setFormData({ ...formData, use_recipe: checked })}
                />
                <Label htmlFor="use_recipe">Use Recipe (multiple ingredients)</Label>
              </div>
              
              {/* Direct Ingredient Select (when not using recipe) */}
              {!formData.use_recipe && (
                <div className="space-y-2">
                  <Label htmlFor="direct_ingredient_id">
                    Direct Ingredient (optional — leave blank to track this item's own stock)
                  </Label>
                  <Select
                    value={formData.direct_ingredient_id}
                    onValueChange={(value) => setFormData({ ...formData, direct_ingredient_id: value })}
                  >
                    <SelectTrigger id="direct_ingredient_id">
                      <SelectValue placeholder="Choose ingredient" />
                    </SelectTrigger>
                    <SelectContent>
                      {ingredients.map((ing) => (
                        <SelectItem key={ing.id} value={ing.id}>
                          {ing.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {formData.track_stock
                      ? 'Required only when stock tracking is enabled without a recipe.'
                      : 'Optional for regular menu items that do not deduct inventory.'}
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleCategories.map((cat) => {
                        return (
                          <SelectItem key={cat.name} value={cat.name}>
                            <div className="flex items-center gap-2">
                              <ServiceCategoryVisual
                                imageUrl={cat.image_url}
                                iconName={cat.icon}
                                label={cat.label}
                                className="flex h-7 w-7 items-center justify-center rounded-lg ring-1"
                                iconClassName="h-4 w-4"
                              />
                              <span>{cat.label}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="purchase_price">Purchasing Price (Cost) *</Label>
                  <Input
                    id="purchase_price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.purchase_price}
                    onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                    placeholder="0.00"
                    className="border-primary/20 focus:border-primary"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Your acquisition cost per unit or estimated food cost.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Selling Price *</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="0.00"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Set the final guest-facing price.
                  </p>
                </div>
              </div>

              {canViewCostInsights && (
                <div className="space-y-3 rounded-xl border border-dashed bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cost and Pricing Preview
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Recipe costs update automatically from ingredient purchase prices and stock-in updates.
                      </p>
                    </div>
                    {selectedDirectIngredient && (
                      <Badge variant="outline" className="whitespace-nowrap">
                        Linked Product
                      </Badge>
                    )}
                  </div>

                  {selectedDirectIngredient && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-background/80 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Inventory Purchase Price</p>
                        <p className="mt-1 font-semibold">{formatCurrency(selectedDirectIngredient.purchase_price)}</p>
                      </div>
                      <div className="rounded-lg bg-background/80 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Inventory Selling Price</p>
                        <p className="mt-1 font-semibold">{formatCurrency(currentSellingPrice)}</p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-background/80 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Estimated Cost</p>
                      <p className="mt-1 font-semibold text-destructive">{formatCurrency(currentEstimatedCost)}</p>
                    </div>
                    <div className="rounded-lg bg-background/80 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Projected Profit</p>
                      <p className="mt-1 font-semibold">{formatCurrency(currentEstimatedProfit)}</p>
                    </div>
                    <div className="rounded-lg bg-background/80 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Projected Margin</p>
                      <p className="mt-1 font-semibold">{currentEstimatedMargin.toFixed(1)}%</p>
                    </div>
                  </div>

                  {!editingItem && !selectedDirectIngredient && (
                    <p className="text-[11px] text-muted-foreground">
                      For recipe-based dishes, save the item first, add ingredients in Recipe Management, then return here to confirm the selling price using the live recipe cost.
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sort_order">Sort Order</Label>
                  <Input
                    id="sort_order"
                    type="number"
                    min="0"
                    value={formData.sort_order}
                    onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                  />
                </div>
                <div className="flex items-center space-x-2 pt-6">
                  <Switch
                    id="is_available"
                    checked={formData.is_available}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_available: checked })}
                  />
                  <Label htmlFor="is_available">Available</Label>
                </div>
              </div>

            {/* Stock Tracking Section */}
<div className="border-t pt-4 space-y-4">
  <div className="flex items-center space-x-2">
    <Switch
      id="track_stock"
      checked={formData.track_stock}
      onCheckedChange={(checked) => setFormData({ ...formData, track_stock: checked })}
    />
    <Label htmlFor="track_stock">Track Stock</Label>
  </div>
  {formData.track_stock && (
    <div className="grid grid-cols-2 gap-4">
      {/* Only show Current Stock input when ADDING, not editing */}
      {!editingItem && (
        <div className="space-y-2">
          <Label htmlFor="stock_quantity">Initial Stock</Label>
          <Input
            id="stock_quantity"
            type="number"
            min="0"
            value={formData.stock_quantity}
            onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value })}
          />
        </div>
      )}
      {editingItem && (
        <div className="space-y-2">
          <Label>Current Stock</Label>
          <p className="text-sm font-bold pt-2 text-muted-foreground">
            {editingItem.stock_quantity} — use the stock badge to adjust
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="min_stock_threshold">Min Threshold</Label>
        <Input
          id="min_stock_threshold"
          type="number"
          min="0"
          value={formData.min_stock_threshold}
          onChange={(e) => setFormData({ ...formData, min_stock_threshold: e.target.value })}
        />
      </div>
    </div>
  )}
</div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button 
                onClick={handleSubmit} 
                disabled={addItem.isPending || updateItem.isPending}
              >
                {editingItem ? 'Update' : 'Add'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add/Edit Category Dialog */}
        <Dialog open={isCategoryDialogOpen} onOpenChange={handleCategoryDialogChange}>
          <DialogContent className="flex h-[min(92vh,900px)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:w-[95vw]">
            <DialogHeader className="border-b px-4 py-4 sm:px-6">
              <DialogTitle>
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cat_label">Label *</Label>
                <Input
                  id="cat_label"
                  value={categoryForm.label}
                  onChange={(e) => setCategoryForm({ 
                    ...categoryForm, 
                    label: e.target.value,
                    name: normalizeServiceCategoryName(e.target.value)
                  })}
                  placeholder="e.g., Pool Services"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat_station">Send Orders To</Label>
                <Select
                  value={categoryForm.station}
                  onValueChange={(value: 'kitchen' | 'bar' | 'other') =>
                    setCategoryForm({ ...categoryForm, station: value })
                  }
                >
                  <SelectTrigger id="cat_station">
                    <SelectValue placeholder="Choose route" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kitchen">Kitchen</SelectItem>
                    <SelectItem value="bar">Bar</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  New waiter orders in this category will be routed to the selected station.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat_icon">Icon</Label>
                <div className="space-y-3">
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                      <ServiceCategoryVisual
                        imageUrl={categoryPreviewImage}
                        iconName={categoryForm.icon}
                        label={categoryForm.label || selectedCategoryIcon.label}
                        className="flex h-12 w-12 items-center justify-center rounded-2xl ring-1"
                        iconClassName="h-6 w-6"
                      />
                      <div>
                        <p className="font-medium">{selectedCategoryIcon.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Image shows first. Icon is the fallback in POS, category lists, and menu sections.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                    <Label htmlFor="cat_image">Category Image</Label>
                    <input
                      ref={categoryImageInputRef}
                      id="cat_image"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleCategoryImageChange}
                      className="hidden"
                    />
                    <div
                      onClick={() => categoryImageInputRef.current?.click()}
                      onDrop={handleCategoryImageDrop}
                      onDragOver={handleCategoryImageDragOver}
                      onDragLeave={handleCategoryImageDragLeave}
                      className={cn(
                        'cursor-pointer rounded-xl border-2 border-dashed p-4 transition-colors',
                        isCategoryDropActive
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-background hover:border-primary/40 hover:bg-muted/20',
                      )}
                    >
                      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                          <p className="text-sm font-medium">
                            Drag and drop a category image here
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Or click to choose a file from your device.
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto">
                          <FileUp className="mr-2 h-4 w-4" />
                          Choose Image
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Optimized to WebP at 512px for faster loading. Best results: square image under 5MB.
                    </p>
                    {categoryPreviewImage && (
                      <div className="space-y-3 rounded-lg border bg-background p-3">
                        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                            <div className="relative h-20 w-20 overflow-hidden rounded-2xl ring-1 ring-border bg-slate-100">
                              {categoryPreviewImage ? (
                                <img
                                  src={categoryPreviewImage}
                                  alt={categoryForm.label || 'Category preview'}
                                  className={cn(
                                    'absolute inset-0 h-full w-full object-cover',
                                    hasLocalCategoryImage && 'transition-transform duration-150',
                                  )}
                                  style={
                                    hasLocalCategoryImage
                                      ? {
                                          transform: `translate(${categoryImageTransform.offsetX * CATEGORY_IMAGE_OFFSET_LIMIT}%, ${categoryImageTransform.offsetY * CATEGORY_IMAGE_OFFSET_LIMIT}%) scale(${categoryImageTransform.zoom})`,
                                        }
                                      : undefined
                                  }
                                />
                              ) : null}
                            </div>
                            <div>
                              <p className="text-sm font-medium">
                                {hasLocalCategoryImage ? 'Square cover preview' : 'Current category image'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {hasLocalCategoryImage
                                  ? 'Crop and positioning changes are applied to the final uploaded WebP.'
                                  : 'Drop a new image to replace and crop this category image.'}
                              </p>
                            </div>
                          </div>
                          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                            {hasLocalCategoryImage && categoryForm.image_url && (
                              <Button type="button" variant="outline" size="sm" onClick={discardPendingCategoryImage}>
                                Discard New
                              </Button>
                            )}
                            <Button type="button" variant="outline" size="sm" onClick={removeCategoryImageSelection}>
                              Remove
                            </Button>
                          </div>
                        </div>
                        {hasLocalCategoryImage && (
                          <div className="space-y-4 rounded-xl border bg-muted/20 p-3">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Zoom</span>
                                <span>{categoryImageTransform.zoom.toFixed(2)}x</span>
                              </div>
                              <Slider
                                value={[categoryImageTransform.zoom]}
                                min={1}
                                max={2.5}
                                step={0.05}
                                onValueChange={([zoom]) =>
                                  setCategoryImageTransform((current) => ({
                                    ...current,
                                    zoom: zoom ?? current.zoom,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Horizontal Crop</span>
                                <span>{Math.round(categoryImageTransform.offsetX * 100)}%</span>
                              </div>
                              <Slider
                                value={[categoryImageTransform.offsetX * 100]}
                                min={-100}
                                max={100}
                                step={1}
                                onValueChange={([offsetX]) =>
                                  setCategoryImageTransform((current) => ({
                                    ...current,
                                    offsetX: (offsetX ?? 0) / 100,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Vertical Crop</span>
                                <span>{Math.round(categoryImageTransform.offsetY * 100)}%</span>
                              </div>
                              <Slider
                                value={[categoryImageTransform.offsetY * 100]}
                                min={-100}
                                max={100}
                                step={1}
                                onValueChange={([offsetY]) =>
                                  setCategoryImageTransform((current) => ({
                                    ...current,
                                    offsetY: (offsetY ?? 0) / 100,
                                  }))
                                }
                              />
                            </div>
                          </div>
                        )}
                        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                          <ServiceCategoryVisual
                            imageUrl={categoryPreviewImage}
                            iconName={categoryForm.icon}
                            label={categoryForm.label || 'Category preview'}
                            className="flex h-14 w-14 items-center justify-center rounded-xl ring-1"
                            iconClassName="h-6 w-6"
                          />
                          <div>
                            <p className="text-sm font-medium">Live category preview</p>
                            <p className="text-xs text-muted-foreground">
                              Saved into the fast public `category-images` bucket after you submit.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {SERVICE_CATEGORY_ICON_OPTIONS.map((option) => {
                      const IconComponent = option.icon;
                      const isSelected = categoryForm.icon === option.key;

                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setCategoryForm({ ...categoryForm, icon: option.key })}
                          className={cn(
                            'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                            isSelected
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border hover:border-primary/30 hover:bg-muted/40',
                          )}
                        >
                          <span className={cn(
                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1',
                            option.swatchClassName,
                          )}>
                            <IconComponent className="h-5 w-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{option.label}</span>
                            <span className="block truncate text-xs text-muted-foreground">{option.key}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat_sort">Sort Order</Label>
                <Input
                  id="cat_sort"
                  type="number"
                  min="0"
                  value={categoryForm.sort_order}
                  onChange={(e) => setCategoryForm({ ...categoryForm, sort_order: e.target.value })}
                />
              </div>
              </div>
            </div>
            <DialogFooter className="border-t px-4 py-4 sm:px-6">
              <DialogClose asChild>
                <Button variant="outline" className="w-full sm:w-auto">Cancel</Button>
              </DialogClose>
              <Button
                onClick={handleCategorySubmit}
                disabled={addCategory.isPending || updateCategory.isPending || isCategoryImageUploading}
                className="w-full sm:w-auto"
              >
                {isCategoryImageUploading ? 'Uploading...' : editingCategory ? 'Update' : 'Add'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Stock Movement Dialog */}
        <Dialog
          open={isStockDialogOpen}
          onOpenChange={(open) => {
            setIsStockDialogOpen(open);
            if (!open) {
              setStockItem(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adjust Stock: {resolvedStockItem?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Current Stock</p>
                <p className="text-3xl font-bold">{resolvedStockItemQuantity}</p>
              </div>
              <div className="space-y-2">
                <Label>Movement Type</Label>
                <Select
                  value={stockMovement.type}
                  onValueChange={(value: 'in' | 'out') => setStockMovement({ ...stockMovement, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        Stock In
                      </div>
                    </SelectItem>
                    <SelectItem value="out">
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-destructive" />
                        Stock Out
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock_qty">Quantity</Label>
                <Input
                  id="stock_qty"
                  type="number"
                  min="1"
                  value={stockMovement.quantity}
                  onChange={(e) => setStockMovement({ ...stockMovement, quantity: e.target.value })}
                  placeholder="Enter quantity"
                />
              </div>

              {stockMovement.type === 'in' && (
                <div className="space-y-2">
                  <Label htmlFor="stock_price">Purchase Price (per unit)</Label>
                  <Input
                    id="stock_price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={stockMovement.purchasePrice}
                    onChange={(e) => setStockMovement({ ...stockMovement, purchasePrice: e.target.value })}
                    placeholder="0.00"
                  />
                  <p className="text-[10px] text-muted-foreground italic">
                    Updating this will update the item's default purchasing price.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="stock_reason">Reason</Label>
                <Input
                  id="stock_reason"
                  value={stockMovement.reason}
                  onChange={(e) => setStockMovement({ ...stockMovement, reason: e.target.value })}
                  placeholder="e.g., Restock, Damage, Consumed"
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleStockSubmit} disabled={updateItem.isPending}>
                {stockMovement.type === 'in' ? 'Add Stock' : 'Remove Stock'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Recipe Management Dialog */}
        <RecipeDialog 
  open={isRecipeDialogOpen} 
  onOpenChange={setIsRecipeDialogOpen}
  serviceItem={recipeItem}
  ingredients={ingredients}
  formatCurrency={formatCurrency}
  inventoryLocations={inventoryLocations}
  location={resolveInventorySourceLocation(recipeItem)}
/>

        {/* Wastage Reporting Dialog */}
        <WastageDialog
          open={isWastageDialogOpen}
          onOpenChange={(open) => {
            setIsWastageDialogOpen(open);
            if (!open) {
              setWastageServiceItem(null);
            }
          }}
          serviceItem={wastageServiceItem}
          ingredients={ingredients}
        />

        {/* Ingredient Management Dialog */}
        <Dialog open={isIngredientDialogOpen} onOpenChange={setIsIngredientDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingIngredient ? 'Edit Ingredient' : 'Add New Ingredient'}</DialogTitle>
              <DialogDescription>
                Base ingredients used in recipes for dishes and drinks.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="ing_name">Name *</Label>
                <Input 
                  id="ing_name" 
                  value={ingredientForm.name} 
                  onChange={e => setIngredientForm({ ...ingredientForm, name: e.target.value })}
                  placeholder="e.g., Raw Chicken, Whisky Bottle"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={ingredientForm.category} onValueChange={v => setIngredientForm({ ...ingredientForm, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kitchen">Kitchen</SelectItem>
                      <SelectItem value="bar">Bar</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select value={ingredientForm.unit} onValueChange={v => setIngredientForm({ ...ingredientForm, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pcs">pcs (bottles/cans)</SelectItem>
                      <SelectItem value="g">grams</SelectItem>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="ml">ml</SelectItem>
                      <SelectItem value="l">liter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Purchasing Price (Cost) *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input 
                      type="number" 
                      step="0.01"
                      className="pl-7"
                      value={ingredientForm.purchase_price} 
                      onChange={e => setIngredientForm({ ...ingredientForm, purchase_price: e.target.value })}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground italic">
                    Per {ingredientForm.unit || 'unit'}.
                  </p>
                </div>
                {!editingIngredient ? (
                  <div className="space-y-2">
                    <Label>Initial Stock ({ingredientForm.unit})</Label>
                    <Input 
                      type="number" 
                      value={ingredientForm.stock_quantity} 
                      onChange={e => setIngredientForm({ ...ingredientForm, stock_quantity: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Min Stock Threshold</Label>
                    <Input 
                      type="number" 
                      value={ingredientForm.min_stock_threshold} 
                      onChange={e => setIngredientForm({ ...ingredientForm, min_stock_threshold: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {!editingIngredient && (
                <div className="space-y-2">
                  <Label>Min Stock Threshold</Label>
                  <Input 
                    type="number" 
                    value={ingredientForm.min_stock_threshold} 
                    onChange={e => setIngredientForm({ ...ingredientForm, min_stock_threshold: e.target.value })}
                  />
                </div>
              )}

              <Separator />

              {/* Advanced Tracking Controls */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Liquid Volume Tracking</Label>
                    <p className="text-xs text-muted-foreground font-medium">Track ml/shots from open bottles</p>
                  </div>
                  <Switch 
                    checked={ingredientForm.is_liquid} 
                    onCheckedChange={checked => setIngredientForm({ ...ingredientForm, is_liquid: checked })}
                  />
                </div>

                {ingredientForm.is_liquid && (
                  <div className="grid grid-cols-2 gap-4 bg-muted/30 p-3 rounded-lg border border-dashed">
                    <div className="space-y-2">
                      <Label className="text-xs">Volume per Bottle (ml)</Label>
                      <Input 
                        type="number" 
                        value={ingredientForm.volume_per_unit} 
                        onChange={e => setIngredientForm({ ...ingredientForm, volume_per_unit: e.target.value })}
                        placeholder="750"
                      />
                    </div>
                    <div className="flex items-center space-x-2 pt-6">
                      <ThermometerSnowflake className="h-4 w-4 text-primary" />
                      <span className="text-[10px] text-muted-foreground italic leading-tight">Allows recipe deduction in ml/cl</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Track Empty Returns</Label>
                    <p className="text-xs text-muted-foreground font-medium">Log empty bottles for supplier return</p>
                  </div>
                  <Switch 
                    checked={ingredientForm.track_empties} 
                    onCheckedChange={checked => setIngredientForm({ ...ingredientForm, track_empties: checked })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsIngredientDialogOpen(false)}>Cancel</Button>
              <Button onClick={async () => {
                const data = {
                  name: ingredientForm.name,
                  description: ingredientForm.description || null,
                  purchase_price: parseFloat(ingredientForm.purchase_price) || 0,
                  min_stock_threshold: parseFloat(ingredientForm.min_stock_threshold) || 5,
                  unit: ingredientForm.unit,
                  category: ingredientForm.category,
                  is_liquid: ingredientForm.is_liquid,
                  volume_per_unit: parseFloat(ingredientForm.volume_per_unit) || 1,
                  track_empties: ingredientForm.track_empties,
                  stock_quantity: editingIngredient ? editingIngredient.stock_quantity : parseFloat(ingredientForm.stock_quantity) || 0,
                };
                if (editingIngredient) {
                  await updateIngredient.mutateAsync({ id: editingIngredient.id, updates: data });
                } else {
                  await addIngredient.mutateAsync(data);
                }
                setIsIngredientDialogOpen(false);
              }} disabled={addIngredient.isPending || updateIngredient.isPending}>
                {editingIngredient ? 'Update' : 'Add'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Ingredient Stock Adjustment Dialog */}
        <Dialog open={isIngredientStockDialogOpen} onOpenChange={setIsIngredientStockDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Stock Management: {editingIngredient?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg border">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Full Units</p>
                  <p className="text-2xl font-black">{editingIngredient?.stock_quantity || 0} {editingIngredient?.unit}</p>
                </div>
                {editingIngredient?.is_liquid && (
                  <div className="text-center p-4 bg-primary/5 rounded-lg border border-primary/20">
                    <p className="text-[10px] uppercase font-bold text-primary mb-1">Open Volume</p>
                    <p className="text-2xl font-black text-primary">{editingIngredient?.open_unit_volume || 0} ml</p>
                  </div>
                )}
              </div>

              {editingIngredient?.track_empties && (
                <div className="p-3 bg-orange-50 border border-orange-100 rounded-lg flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-orange-600" />
                    <span className="text-sm font-medium text-orange-800">Empties on Hand:</span>
                  </div>
                  <Badge variant="outline" className="bg-white text-orange-700 border-orange-200 font-bold">
                    {editingIngredient.empty_units_count || 0} pcs
                  </Badge>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <Label>Action Type</Label>
                <Select value={stockMovement.type} onValueChange={(v: any) => setStockMovement({ ...stockMovement, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Restock (Add Full Units)</SelectItem>
                    <SelectItem value="out">Waste/Use (Remove Units)</SelectItem>
                    <SelectItem value="adjustment">Audit (Set Absolute Stock)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {stockMovement.type === 'in' && (
                <div className="space-y-2">
                  <Label>Purchase Price (per {editingIngredient?.unit})</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input 
                      type="number" 
                      className="pl-7"
                      value={stockMovement.purchasePrice} 
                      onChange={e => setStockMovement({ ...stockMovement, purchasePrice: e.target.value })} 
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Quantity ({editingIngredient?.unit})</Label>
                  <Input 
                    type="number" 
                    value={stockMovement.quantity} 
                    onChange={e => setStockMovement({ ...stockMovement, quantity: e.target.value })} 
                  />
                </div>
                {editingIngredient?.is_liquid && stockMovement.type === 'adjustment' && (
                  <div className="space-y-2">
                    <Label>Open Bottle Vol (ml)</Label>
                    <Input 
                      type="number" 
                      placeholder="e.g. 350"
                      value={editingIngredient.open_unit_volume}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        setEditingIngredient({ ...editingIngredient, open_unit_volume: val });
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Reason / Note</Label>
                <Input value={stockMovement.reason} onChange={e => setStockMovement({ ...stockMovement, reason: e.target.value })} placeholder="e.g., Monthly Audit, Damage" />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2 pt-4 border-t">
              {editingIngredient?.track_empties && editingIngredient.empty_units_count > 0 && (
                <Button 
                  variant="outline" 
                  className="mr-auto text-orange-600 border-orange-200 hover:bg-orange-50 font-bold text-xs"
                  onClick={async () => {
                    const qty = prompt(`How many empty bottles are you returning? (Max ${editingIngredient.empty_units_count})`);
                    if (qty && parseInt(qty) > 0) {
                      const returnQty = Math.min(parseInt(qty), editingIngredient.empty_units_count);
                      await updateIngredient.mutateAsync({
                        id: editingIngredient.id,
                        updates: { empty_units_count: editingIngredient.empty_units_count - returnQty }
                      });
                      toast.success(`Logged return of ${returnQty} empty bottles`);
                    }
                  }}
                >
                  Return Empties
                </Button>
              )}
              <Button variant="outline" onClick={() => setIsIngredientStockDialogOpen(false)}>Cancel</Button>
              <Button 
                className="font-bold"
                onClick={async () => {
                if (!editingIngredient) return;
                
                // If auditing volume, update it first
                if (stockMovement.type === 'adjustment' && editingIngredient.is_liquid) {
                  await updateIngredient.mutateAsync({
                    id: editingIngredient.id,
                    updates: { open_unit_volume: editingIngredient.open_unit_volume }
                  });
                }

                await addIngredientStock.mutateAsync({
                  ingredientId: editingIngredient.id,
                  quantity: parseFloat(stockMovement.quantity),
                  type: stockMovement.type,
                  reason: stockMovement.reason,
                  purchasePrice: stockMovement.purchasePrice ? parseFloat(stockMovement.purchasePrice) : undefined
                });
                setIsIngredientStockDialogOpen(false);
              }}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

interface RecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceItem: ServiceMenuItem | null;
  ingredients?: HotelIngredient[];
  formatCurrency: (amount: number) => string;
  inventoryLocations?: { ingredient_id: string; location_code: string; quantity: number }[];
  location?: 'kitchen' | 'bar';
}

function RecipeDialog({ open, onOpenChange, serviceItem, ingredients = [], formatCurrency, inventoryLocations = [], location = 'kitchen' }: RecipeDialogProps) {
  const { data: recipes = [], isLoading } = useServiceItemRecipes(serviceItem?.id || '');
  const addRecipeItem = useAddRecipeIngredient();
  const removeRecipeItem = useRemoveRecipeIngredient();
  
  const [selectedId, setSelectedId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('pcs');
  const getStockAtLocation = (ingredientId: string) => {
    const loc = inventoryLocations.find(
      l => l.ingredient_id === ingredientId && l.location_code === location
    );
    return loc ? Number(loc.quantity) || 0 : 0;
  };

  const getIngredientStatus = (ingredientId: string, quantityRequired: number) => {
    const available = getStockAtLocation(ingredientId);
    if (available <= 0) return 'missing';
    if (available < quantityRequired) return 'low';
    return 'ok';
  };

  // Update unit when selection changes
  useEffect(() => {
    if (selectedId) {
      const ing = ingredients.find(i => i.id === selectedId);
      if (ing) setUnit(ing.unit);
    }
  }, [selectedId, ingredients]);

  const handleAdd = async () => {
    if (!serviceItem || !selectedId || !quantity) return;
    
    // Find the item to get its unit
    let itemUnit = unit;
    const ing = ingredients.find(i => i.id === selectedId);
    if (ing) itemUnit = ing.unit;

    await addRecipeItem.mutateAsync({
      service_item_id: serviceItem.id,
      ingredient_id: selectedId,
      quantity_required: parseFloat(quantity),
      unit: itemUnit,
      is_extra: false,
    });
    
    setSelectedId('');
    setQuantity('');
  };

  const totalCost = recipes.reduce((sum, r) => {
    const cost = r.ingredient?.purchase_price || 0;
    return sum + (r.quantity_required * cost);
  }, 0);

  const profit = serviceItem ? serviceItem.selling_price - totalCost : 0;
  const margin = serviceItem && serviceItem.selling_price > 0 ? (profit / serviceItem.selling_price) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Recipe Management: {serviceItem?.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="bg-muted/50 border-none">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Selling Price</p>
                <p className="text-xl font-bold">{formatCurrency(serviceItem?.selling_price || 0)}</p>
              </CardContent>
            </Card>
            <Card className="bg-muted/50 border-none">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Cost per Portion</p>
                <p className="text-xl font-bold text-destructive">{formatCurrency(totalCost)}</p>
              </CardContent>
            </Card>
            <Card className="bg-muted/50 border-none">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Profit Margin</p>
                <div className="flex items-center gap-2">
                  <p className={`text-xl font-bold ${margin > 30 ? 'text-green-600' : 'text-orange-500'}`}>
                    {margin.toFixed(1)}%
                  </p>
                  {margin > 30 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-orange-500" />}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Add Ingredient Form */}
          <div className="bg-muted/30 p-4 rounded-lg border border-dashed space-y-4">


            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label>Select Ingredient</Label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select ingredient..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ingredients.map(i => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} ({formatCurrency(i.purchase_price)} / {i.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32 space-y-2">
                <Label>Qty per Dish</Label>
                <div className="flex items-center gap-2">
                  <Input 
                    type="number" 
                    step="0.001" 
                    value={quantity} 
                    onChange={e => setQuantity(e.target.value)}
                    placeholder="0.00"
                    className="flex-1"
                  />
                  <Badge variant="outline" className="h-10 px-2 font-mono text-[10px]">
                    {unit}
                  </Badge>
                </div>
              </div>
              <Button onClick={handleAdd} disabled={addRecipeItem.isPending}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Ingredient List */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Ingredients List
            </h3>
            {isLoading ? (
              <p className="text-center py-4 text-muted-foreground">Loading recipe...</p>
            ) : recipes.length === 0 ? (
              <div className="text-center py-8 border rounded-lg bg-muted/20">
                <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No ingredients added yet.</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-center">Quantity</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recipes.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>
  <div className="flex flex-col gap-1">
    <span className="font-medium">{r.ingredient?.name}</span>
    <span className="text-[10px] text-muted-foreground uppercase">Restaurant Ingredient</span>
    {(() => {
      const status = getIngredientStatus(r.ingredient_id, r.quantity_required);
      if (status === 'missing') {
        return (
          <Badge variant="destructive" className="w-fit text-[10px] gap-1">
            <AlertCircle className="h-3 w-3" />
            Missing in {location === 'bar' ? 'Bar' : 'Kitchen'}
          </Badge>
        );
      }
      if (status === 'low') {
        return (
          <Badge variant="outline" className="w-fit text-[10px] border-orange-400 text-orange-500 gap-1">
            <AlertCircle className="h-3 w-3" />
            Low stock ({getStockAtLocation(r.ingredient_id)} {r.unit} left)
          </Badge>
        );
      }
      return (
        <span className="text-[10px] text-green-600">
          In stock — deducts {r.quantity_required} {r.unit} per order
        </span>
      );
    })()}
  </div>
</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{r.quantity_required} {r.unit}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatCurrency(r.ingredient?.purchase_price || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(r.quantity_required * (r.ingredient?.purchase_price || 0))}
                        </TableCell>
                        <TableCell>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive"
                            onClick={() => removeRecipeItem.mutateAsync({ id: r.id, serviceItemId: serviceItem!.id })}
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="bg-muted/20 -mx-6 -mb-6 p-4">
          <p className="text-xs text-muted-foreground mr-auto flex items-center gap-1">
            <Info className="h-3 w-3" />
            Stock will be automatically deducted when this item is ordered.
          </p>
          <DialogClose asChild>
            <Button>Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface WastageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceItem: ServiceMenuItem | null;
  ingredients?: HotelIngredient[];
}

function WastageDialog({ open, onOpenChange, serviceItem, ingredients = [] }: WastageDialogProps) {
  const addWastage = useAddWastageLog();
  const [selectedId, setSelectedId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [reason, setReason] = useState<'expired' | 'spoiled' | 'prep_error' | 'over_used' | 'other'>('spoiled');
  const [notes, setNotes] = useState('');


  // Update unit when selection changes
  useEffect(() => {
    if (selectedId) {
      const ing = ingredients.find(i => i.id === selectedId);
      if (ing) setUnit(ing.unit);
    }
  }, [selectedId, ingredients]);

  const handleSubmit = async () => {
    if (!selectedId || !quantity) return;
    
    await addWastage.mutateAsync({
      ingredient_id: selectedId,
      service_item_id: serviceItem?.id || null,
      quantity: parseFloat(quantity),
      reason,
      notes,
    });
    
    onOpenChange(false);
    setQuantity('');
    setNotes('');
    setSelectedId('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ThermometerSnowflake className="h-5 w-5 text-destructive" />
            Report Wastage / Loss
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">

          <div className="space-y-2">
            <Label>Item to Report</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger>
                <SelectValue placeholder="Select ingredient..." />
              </SelectTrigger>
              <SelectContent>
                {ingredients.map(i => (
                  <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Quantity Wasted</Label>
            <div className="flex items-center gap-2">
              <Input 
                type="number" 
                step="0.001" 
                value={quantity} 
                onChange={e => setQuantity(e.target.value)}
                placeholder="0.00"
                className="flex-1"
              />
              <Badge variant="outline" className="h-10 px-3 font-mono">
                {unit}
              </Badge>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v: any) => setReason(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="spoiled">Spoiled / Rotten</SelectItem>
                <SelectItem value="prep_error">Preparation Error</SelectItem>
                <SelectItem value="over_used">Over-used (Variance)</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea 
              value={notes} 
              onChange={e => setNotes(e.target.value)}
              placeholder="Add details about the wastage..."
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleSubmit} disabled={addWastage.isPending}>
            Report Wastage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ServiceTableProps {
  items: ServiceMenuItem[];
  onEdit: (item: ServiceMenuItem) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, currentValue: boolean) => void;
  onStock: (item: ServiceMenuItem) => void;
  onRecipe: (item: ServiceMenuItem) => void;
  onWastage: (item?: ServiceMenuItem) => void;
  formatCurrency: (amount: number) => string;
  getProductStock: (productId: string) => number;
}

function ServiceTable({ 
  items, 
  onEdit, 
  onDelete, 
  onToggle, 
  onStock, 
  onRecipe,
  onWastage,
  formatCurrency, 
  getProductStock 
}: ServiceTableProps) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="min-w-[800px]">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Food Cost</TableHead>
              <TableHead className="text-center">Stock</TableHead>
              <TableHead className="text-center">Available</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const displayStock = item.stock_quantity;
              const isLowStock = item.track_stock && displayStock <= item.min_stock_threshold;
              const profitMargin = item.selling_price > 0 ? ((item.selling_price - item.purchase_price) / item.selling_price) * 100 : 0;
              
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.name}</span>
                      </div>
                      {item.description && (
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {item.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(item.selling_price)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-sm text-destructive">
                        {formatCurrency(item.purchase_price)}
                      </span>
                      <span className={`text-[10px] font-medium ${profitMargin > 30 ? 'text-green-600' : 'text-orange-500'}`}>
                        {profitMargin.toFixed(0)}% Margin
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {item.track_stock ? (
                      <Badge 
                        variant={isLowStock ? 'destructive' : 'secondary'}
                        className="cursor-pointer"
                        onClick={() => onStock(item)}
                      >
                        {displayStock}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={item.is_available}
                      onCheckedChange={() => onToggle(item.id, item.is_available)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => onRecipe(item)} 
                        title="Manage Recipe (Ingredients)"
                        className="text-primary hover:text-primary hover:bg-primary/10"
                      >
                        <ClipboardList className="h-4 w-4" />
                      </Button>
                      
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => onWastage(item)} 
                        title="Report Wastage"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <ThermometerSnowflake className="h-4 w-4" />
                      </Button>

                      <Button variant="ghost" size="icon" onClick={() => onEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Item</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{item.name}"?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onDelete(item.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}