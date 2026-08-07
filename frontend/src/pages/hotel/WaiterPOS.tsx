import { useState, useMemo, useEffect, memo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { useAvailableServices, getActiveServicePrice, isOutOfStock } from "@/hooks/useServiceMenu";
import { useActiveServiceCategories } from "@/hooks/useServiceCategories";
import { useHotelPOS, HotelCartItem } from "@/hooks/useHotelPOS";
import {
  usePlaceOrder,
  setHotelTableStatus,
  useUpdateOrderStatus,
  useActiveOrders,
  useWaiterOrders,
  useRequestOrderVerification,
 releaseHotelTableIfNoActiveOrders,
  useAddItemsToOrder,
  useCancelOrderItem,
  useUpdateOrderItemQuantity,
} from "@/hooks/useHotelOrders";
import { useOpenHotelTableSession, useActiveTableSession } from "@/hooks/useHotelTableSessions";
import { useHotelTables } from "@/hooks/useHotelTables";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { useHotelInfo } from "@/hooks/useHotel";
import { useKOTPrint } from "@/hooks/useKOTPrint";
import { KOTPrint } from "@/components/hotel/KOTPrint";
import type { HotelTable } from "@/types/hotel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Search, Plus, CreditCard, ShoppingBag, Loader2,
  CheckCircle2, Send, ClipboardList, ShoppingCart, Monitor, LogOut, LayoutGrid, RefreshCw, X, Receipt, Clock, Check,
  User, Wallet, Banknote, Smartphone, Printer, SplitSquareHorizontal, AlertCircle, Eye, ChefHat, GlassWater, UserRound
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CartItems } from "./components/CartItems";
import { ActiveOrders } from "./components/ActiveOrders";
import { ServiceCategoryVisual } from "@/components/hotel/ServiceCategoryVisual";
import { normalizeServiceCategoryName, formatServiceCategoryLabel, inferServiceCategoryIcon, resolveServiceCategoryStation, inferServiceCategoryStation } from "@/lib/serviceCategoryUtils";
import { SplitBillDialog } from "./components/SplitBillDialog";
import { HotelReceiptPrint } from "@/components/hotel/HotelReceiptPrint";
import { HotelCustomerSelectorDialog } from "@/components/hotel/HotelCustomerSelectorDialog";
import { type Customer } from "@/hooks/useCustomers";
import type { HotelTableSession } from "@/types/hotel";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'momo', label: 'Momo', icon: Smartphone },
  { id: 'split', label: 'Split', icon: SplitSquareHorizontal },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
    preparing: "bg-blue-100 text-blue-700 border-blue-200",
    ready: "bg-green-100 text-green-700 border-green-200",
    served: "bg-gray-100 text-gray-700 border-gray-200",
    billed: "bg-emerald-100 text-emerald-700 border-emerald-200",
    pending_handover: "bg-purple-100 text-purple-700 border-purple-200",
    awaiting_approval: "bg-amber-100 text-amber-700 border-amber-200",
    settled: "bg-emerald-100 text-emerald-700 border-emerald-200",
    cancelled: "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
      map[status] ?? "bg-slate-100 text-slate-600 border-slate-200"
    )}>
      {status}
    </span>
  );
}

export default function HotelPOSWaiter() {
  const { formatCurrency } = useSettingsContext();
  const { activeStaff, logoutStaff, activeShift } = useStaffSession();
  const queryClient = useQueryClient();

  // ============ MULTI-WAITER STATE ============
  const [currentWaiterId] = useState<string>(activeStaff?.staff_id || '');
  const waiterId = currentWaiterId || activeStaff?.staff_id;
  const waiterName = activeStaff ? `${activeStaff.first_name} ${activeStaff.last_name}` : '';

  // ============ TABLE & ORDER STATE ============
  const [selectedTable, setSelectedTable] = useState<HotelTable | null>(null);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [rightTab, setRightTab] = useState<"cart" | "orders">("cart");
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [showMonitor, setShowMonitor] = useState(false);

  // ============ MONITOR DIALOG STATE ============
  const [monitorOrder, setMonitorOrder] = useState<any>(null);
  const [showPaymentCollectDialog, setShowPaymentCollectDialog] = useState(false);
  const [collectingOrder, setCollectingOrder] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerSelector, setShowCustomerSelector] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [showCategorySidebar, setShowCategorySidebar] = useState(false);
  
  // ============ SPLIT BILL STATE ============
  const [showSplitBillDialog, setShowSplitBillDialog] = useState(false);
  const [splitBillOrder, setSplitBillOrder] = useState<any>(null);
  const [showEditOrderDialog, setShowEditOrderDialog] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [showOrderChoiceDialog, setShowOrderChoiceDialog] = useState(false);

  // ============ DATA FETCHING ============
  const { data: services = [], isLoading: servicesLoading } = useAvailableServices();
  const { data: categories = [] } = useActiveServiceCategories();
  const placeOrder = usePlaceOrder();
  const updateOrderStatus = useUpdateOrderStatus();
  const requestVerification = useRequestOrderVerification();
  const addItemsToOrder = useAddItemsToOrder();
  const cancelOrderItem = useCancelOrderItem();
  const updateOrderItemQuantity = useUpdateOrderItemQuantity();
  const openTableSession = useOpenHotelTableSession();
  const { data: hotelInfo } = useHotelInfo();
  const { data: tables = [] } = useHotelTables(false);
  
  // ============ KOT PRINT ============
  const { 
    currentKOT, 
    handlePrintComplete, 
    printKitchenOrder, 
    printBarOrder 
  } = useKOTPrint();

  const effectiveTaxRate = hotelInfo?.tax_rate ?? 18;
  const effectiveTaxInclusive = hotelInfo?.tax_inclusive ?? false;

  const {
    cart, discount, subtotal, discountAmount,
    taxRate, taxAmount, total, addToCart, updateQuantity,
    removeFromCart, clearCart, setDiscount
  } = useHotelPOS(effectiveTaxRate, null, waiterId, effectiveTaxInclusive, []);

 const { data: myOrders = [], refetch: refetchOrders } = useWaiterOrders(waiterId);
  const { data: monitorOrders = [], refetch: refetchMonitor } = useActiveOrders(undefined, { enabled: true });

  const ACTIVE_TABLE_ORDER_STATUSES_EXCLUDED = ['billed', 'cancelled', 'settled', 'pending_handover', 'awaiting_approval'];

  const getActiveOrderForTable = (tableId: string) => {
    return (
      myOrders.find(
        (o: any) =>
          o.table_id === tableId &&
          !ACTIVE_TABLE_ORDER_STATUSES_EXCLUDED.includes(o.status)
      ) || null
    );
  };

  const handleSelectTable = (table: HotelTable) => {
    const ownActiveOrder = getActiveOrderForTable(table.id);

    if (table.status === 'occupied' && selectedTable?.id !== table.id && !ownActiveOrder) {
      toast.error('Table is already occupied by another waiter');
      return;
    }

    if (table.status === 'available' || table.status === 'free') {
      queryClient.setQueryData(['hotel-tables'], (oldData: any) => {
        if (!oldData) return oldData;
        return oldData.map((t: HotelTable) => 
          t.id === table.id ? { ...t, status: 'occupied' } : t
        );
      });

      setHotelTableStatus(table.id, table.table_number, 'occupied', queryClient).catch(() => {
        queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      });
    }

    setSelectedTable(table);
    setShowTableDialog(false);
    toast.success(`Table ${table.table_number} selected`);
  };

  const handleAddItemsToExistingOrder = async (order: any) => {
    setIsProcessing(true);
    try {
      const preparedItems = cart.map((item) => {
        const explicitStation = (item.service as any)?.station;
        const categoryMatchStation = categories.find(
          (c) => normalizeServiceCategoryName(c.name) === normalizeServiceCategoryName(item.service.category)
        )?.station;
        const inferred = inferServiceCategoryStation(item.service.category);
        const orderStation = explicitStation || categoryMatchStation || inferred;
        const resolvedStation = orderStation === 'other' ? 'kitchen' : orderStation;
        return {
          serviceItemId: item.service.id,
          name: item.service.name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          notes: item.notes || undefined,
          category: item.service.category,
          station: resolvedStation,
        };
      });

      await addItemsToOrder.mutateAsync({
        orderId: order.id,
        items: preparedItems,
        sessionId: order.session_id,
        taxRate: effectiveTaxRate,
        taxInclusive: effectiveTaxInclusive,
      });

      const kitchenItems = preparedItems
        .filter((i) => i.station === 'kitchen')
        .map((i) => ({ name: i.name, quantity: i.quantity, notes: i.notes || null }));
      const barItems = preparedItems
        .filter((i) => i.station === 'bar')
        .map((i) => ({ name: i.name, quantity: i.quantity, notes: i.notes || null }));

      const kotTimestamp = new Date();
      const kotOrderNumber = `#${(order.order_number || order.id).toString().slice(-4)}`;

      if (kitchenItems.length > 0) {
        printKitchenOrder({
          orderNumber: kotOrderNumber,
          tableNumber: order.table_number,
          waiterName: waiterName || activeStaff?.first_name,
          items: kitchenItems,
          orderNotes: orderNotes || undefined,
          type: 'new',
          timestamp: kotTimestamp,
        });
      }
      if (barItems.length > 0) {
        printBarOrder({
          orderNumber: kotOrderNumber,
          tableNumber: order.table_number,
          waiterName: waiterName || activeStaff?.first_name,
          items: barItems,
          orderNotes: orderNotes || undefined,
          type: 'new',
          timestamp: kotTimestamp,
        });
      }

      clearCart();
      setOrderNotes('');
      refetchOrders();
      refetchMonitor();
    } catch (error) {
      console.error('Failed to add items to order:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmAddToExistingOrder = async () => {
    setShowOrderChoiceDialog(false);
    if (activeOrderForSelectedTable) {
      await handleAddItemsToExistingOrder(activeOrderForSelectedTable);
    }
  };
const handleConfirmStartNewOrder = async () => {
    setShowOrderChoiceDialog(false);
    await handleCreateNewOrder({ standalone: true });
  };

  const handlePlaceOrder = async () => {
    if (!selectedTable) {
      toast.error('Please select a table first');
      setShowTableDialog(true);
      return;
    }
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    if (!activeStaff?.staff_id) {
      toast.error('No staff logged in');
      return;
    }

    if (activeOrderForSelectedTable) {
      setShowOrderChoiceDialog(true);
      return;
    }

    await handleCreateNewOrder();
  };

  const handleCreateNewOrder = async (opts?: { standalone?: boolean }) => {
    if (!selectedTable) return;

    setIsProcessing(true);
    try {
      const session = opts?.standalone
        ? null
        : await openTableSession.mutateAsync({
            tableId: selectedTable.id,
            guestCount: 1,
          });

      const buildPreparedItems = () => cart.map((item) => {
        const explicitStation = (item.service as any)?.station;
        const categoryMatchStation = categories.find(
          (c) => normalizeServiceCategoryName(c.name) === normalizeServiceCategoryName(item.service.category)
        )?.station;
        const inferred = inferServiceCategoryStation(item.service.category);
        const orderStation = explicitStation || categoryMatchStation || inferred;
        return {
          serviceItemId: item.service.id,
          name: item.service.name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          purchasePrice: item.service.purchase_price,
          notes: item.notes || undefined,
          category: item.service.category,
          station: orderStation === 'other' ? 'kitchen' : (orderStation as any),
          kotStation: (orderStation === 'kitchen' || orderStation === 'bar') ? orderStation : 'other',
        };
      });

      const preparedItems = buildPreparedItems();

      const result = await placeOrder.mutateAsync({
        tableId: selectedTable.id,
        tableNumber: selectedTable.table_number,
        sessionId: session?.id || null,
        waiterId: activeStaff.staff_id,
        staffId: activeStaff.staff_id,
        shiftId: activeShift?.id || undefined,
        taxRate: effectiveTaxRate,
        taxInclusive: effectiveTaxInclusive,
        discount: discount ?? 0,
        orderType: 'dine_in',
        notes: orderNotes || undefined,
        items: preparedItems,
      });

      const kitchenItems = preparedItems
        .filter(item => item.kotStation === 'kitchen')
        .map(item => ({
          name: item.name,
          quantity: item.quantity,
          notes: item.notes || null,
        }));

      const barItems = preparedItems
        .filter(item => item.kotStation === 'bar')
        .map(item => ({
          name: item.name,
          quantity: item.quantity,
          notes: item.notes || null,
        }));

      const kotTimestamp = new Date();
      if (kitchenItems.length > 0 && result) {
        printKitchenOrder({
          orderNumber: `#${(result.order_number || `ORD-${Date.now().toString().slice(-6)}`).toString().slice(-4)}`,
          tableNumber: selectedTable.table_number,
          waiterName: waiterName || activeStaff?.first_name,
          items: kitchenItems,
          orderNotes: orderNotes || undefined,
          type: 'new',
          timestamp: kotTimestamp,
        });
      }

      if (barItems.length > 0 && result) {
        printBarOrder({
          orderNumber: `#${(result.order_number || `ORD-${Date.now().toString().slice(-6)}`).toString().slice(-4)}`,
          tableNumber: selectedTable.table_number,
          waiterName: waiterName || activeStaff?.first_name,
          items: barItems,
          orderNotes: orderNotes || undefined,
          type: 'new',
          timestamp: kotTimestamp,
        });
      }

      toast.success('Order sent to kitchen');
      clearCart();
      setOrderNotes("");
      refetchOrders();
      refetchMonitor();
    } catch (error) {
      console.error('Failed to send order:', error);
      toast.error('Failed to send order');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to cancel this order?')) return;

    setIsProcessing(true);
    try {
      await updateOrderStatus.mutateAsync({
        orderId,
        status: 'cancelled'
      });
      toast.success('Order cancelled');
      refetchOrders();
      
      const order = myOrders.find(o => o.id === orderId);
      if (order?.table_id || order?.table_number) {
        await releaseHotelTableIfNoActiveOrders(
          order.table_id,
          order.table_number,
          orderId,
          'free',
          queryClient
        );
      }
    } catch (error) {
      toast.error('Failed to cancel order');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkAsPaid = async (orderId: string) => {
    setIsProcessing(true);
    try {
      await updateOrderStatus.mutateAsync({
        orderId,
        status: 'billed',
        paymentStatus: 'paid'
      });
      toast.success('Order marked as paid');

      const order = myOrders.find(o => o.id === orderId);
      if (order?.table_id || order?.table_number) {
        await releaseHotelTableIfNoActiveOrders(
          order.table_id,
          order.table_number,
          orderId,
          'free',
          queryClient
        );
      }

      refetchOrders();
    } catch (error) {
      toast.error('Failed to update order');
    } finally {
      setIsProcessing(false);
    }
  };

  const openCollectPayment = (order: any) => {
    setCollectingOrder(order);
    setPaymentMethod('cash');
    setSelectedCustomer(null);
    setShowPaymentCollectDialog(true);
  };

  // Waiters don't settle the bill directly anymore — this submits the order
  // to the cashier for approval (status -> 'pending_handover'). The actual
  // invoice/settlement happens in CashierSettlements.tsx via
  // useApproveAndSettleOrder once the cashier confirms receipt of the money.
  const handleCollectPayment = async () => {
    if (!collectingOrder) return;

    setIsProcessing(true);
    try {
      const customerData = selectedCustomer ? {
        id: selectedCustomer.id,
        name: selectedCustomer.name,
        phone: selectedCustomer.phone,
        email: selectedCustomer.email,
        address: selectedCustomer.address,
        tin_number: selectedCustomer.tin_number,
      } : undefined;

      await requestVerification.mutateAsync({
        orderId: collectingOrder.id,
        paymentMethod,
        staffId: activeStaff?.staff_id,
        shiftId: activeShift?.id || null,
        customerData,
      });

      setShowPaymentCollectDialog(false);
      setCollectingOrder(null);
      setSelectedCustomer(null);
      refetchMonitor();
      refetchOrders();
    } catch (error) {
      console.error('Failed to submit order for cashier verification:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const openSplitBill = (order: any) => {
    setSplitBillOrder(order);
    setShowSplitBillDialog(true);
  };

  const handleSplitBillComplete = async () => {
    setShowSplitBillDialog(false);
    setSplitBillOrder(null);
    refetchMonitor();
    refetchOrders();
    queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
    queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });

    if (splitBillOrder?.table_id || splitBillOrder?.table_number) {
      await releaseHotelTableIfNoActiveOrders(
        splitBillOrder.table_id,
        splitBillOrder.table_number,
        splitBillOrder.id,
        'free',
        queryClient
      );
    }
  };

  const openEditOrder = (order: any) => {
    setEditingOrder(order);
    setShowEditOrderDialog(true);
  };

  const liveEditingOrder = useMemo(() => {
    if (!editingOrder) return null;
    return myOrders.find((o: any) => o.id === editingOrder.id) || editingOrder;
  }, [myOrders, editingOrder]);

  const handleRemoveEditItem = async (item: any) => {
    if (!confirm(`Remove "${item.name}" from this order?`)) return;
    try {
      await cancelOrderItem.mutateAsync({
        itemId: item.id,
        staffId: activeStaff?.staff_id,
        shiftId: activeShift?.id,
        cancelReason: 'Removed by waiter via edit order',
      });
      refetchOrders();
      refetchMonitor();
    } catch (error) {
      console.error('Failed to remove item:', error);
    }
  };

  const handleEditQtyChange = async (item: any, newQty: number) => {
    if (newQty <= 0) {
      await handleRemoveEditItem(item);
      return;
    }
    try {
      await updateOrderItemQuantity.mutateAsync({
        itemId: item.id,
        quantity: newQty,
        staffId: activeStaff?.staff_id,
        shiftId: activeShift?.id,
      });
      refetchOrders();
      refetchMonitor();
    } catch (error) {
      console.error('Failed to update item quantity:', error);
    }
  };

  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filteredServices = useMemo(() => {
    return services.filter(service => {
      const matchesCategory = activeCategory === "all" ||
        normalizeServiceCategoryName(service.category) === normalizeServiceCategoryName(activeCategory);
      const matchesSearch = service.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [services, activeCategory, debouncedSearchTerm]);
  
  const activeOrderForSelectedTable = useMemo(() => {
    if (!selectedTable) return null;
    return getActiveOrderForTable(selectedTable.id);
  }, [myOrders, selectedTable]);

  const visibleCategories = useMemo(() => {
    const categoryMap = new Map<string, typeof categories[number]>();
    categories.forEach((category) => {
      categoryMap.set(normalizeServiceCategoryName(category.name), category);
    });
    services.forEach((service) => {
      const normalizedCategory = normalizeServiceCategoryName(service.category);
      if (!categoryMap.has(normalizedCategory)) {
        categoryMap.set(normalizedCategory, {
          id: `derived-${normalizedCategory}`,
          name: normalizedCategory,
          label: formatServiceCategoryLabel(service.category),
          icon: inferServiceCategoryIcon(service.category),
          image_url: null,
          sort_order: Number.MAX_SAFE_INTEGER,
        });
      }
    });
    return Array.from(categoryMap.values()).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  }, [categories, services]);

  const categoryImageMap = useMemo(() => {
    const map: Record<string, string | null | undefined> = {};
    visibleCategories.forEach((cat) => {
      map[normalizeServiceCategoryName(cat.name)] = cat.image_url;
    });
    return map;
  }, [visibleCategories]);

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [orderNotes, setOrderNotes] = useState("");

  const handlePayment = async () => {
    if (!selectedTable || cart.length === 0) return;
    
    setIsProcessing(true);
    try {
      await handlePlaceOrder();
      setShowPaymentDialog(false);
      setSelectedTable(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRefresh = () => {
    refetchMonitor();
    refetchOrders();
  };

  const toggleCategorySidebar = () => setShowCategorySidebar(v => !v);

  return (
    <Layout disableScroll={true}>
      <div className="fixed inset-0 z-0 bg-gradient-to-br from-emerald-50 via-white to-teal-50" />
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden font-sans text-slate-900">
        
        <header className="relative z-30 shrink-0 border-b-2 border-emerald-200 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 px-4 py-3 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white shadow-md">
                <ShoppingBag className="h-7 w-7 text-emerald-600" />
              </div>
              <div>
                <h1 className="text-xl font-black uppercase tracking-tight text-white">Waiter POS</h1>
                <p className="text-xs font-medium text-emerald-100">
                  👤 {waiterName || activeStaff?.first_name || 'Select Waiter'}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                  ID: {waiterId ? `${waiterId.slice(0, 8)}...` : 'Not logged in'}
                </p>
              </div>
            </div>

            <div className="hidden flex-1 items-center justify-center gap-3 md:flex">
              <Button
                onClick={() => setShowTableDialog(true)}
                className={cn(
                  "h-12 gap-2 px-6 shadow-md transition-all",
                  selectedTable 
                    ? "bg-white text-emerald-700 hover:bg-emerald-50" 
                    : "bg-emerald-500 text-white hover:bg-emerald-400 animate-pulse"
                )}
              >
                <LayoutGrid className="h-5 w-5" />
                <span className="font-bold">
                  {selectedTable ? `Table ${selectedTable.table_number}` : 'Select Table'}
                </span>
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowMonitor(true)}
                className={cn(
                  "h-10 gap-2 border-white/30 shadow-sm hover:bg-white/20",
                  showMonitor ? "bg-white text-emerald-700" : "bg-white/10 text-white"
                )}
                title="Open active orders monitor"
              >
                <Eye className="h-4 w-4" />
                <span className="hidden sm:inline text-xs font-bold">Monitor</span>
              </Button>

              <Button
                variant="outline"
                onClick={handleRefresh}
                className="h-10 gap-2 border-white/30 bg-white/10 text-white shadow-sm hover:bg-white/20"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-2 rounded-lg border-2 border-white/30 bg-white/10 px-3 py-1.5">
                <ClipboardList className="h-4 w-4 text-white" />
                <span className="text-sm font-bold text-white">
                  {monitorOrders.length}
                </span>
              </div>

              <div className="flex items-center gap-2 rounded-lg border-2 border-white/30 bg-white/10 px-3 py-1.5">
                <ShoppingCart className="h-4 w-4 text-white" />
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold uppercase text-emerald-100">{cart.length} items</span>
                  <span className="text-base font-black text-white">{formatCurrency(total)}</span>
                </div>
              </div>

              <Button
                size="sm"
                onClick={handlePlaceOrder}
                disabled={cart.length === 0 || isProcessing || !selectedTable}
                className="h-9 gap-1.5 bg-white px-4 text-emerald-700 shadow-md hover:bg-emerald-50 disabled:opacity-50"
                title={!selectedTable ? "Select table first" : "Send order"}
              >
                {isProcessing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                <span className="hidden lg:inline text-xs font-bold">Send</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPaymentDialog(true)}
                disabled={cart.length === 0 || isProcessing}
                className="h-9 border-white/30 bg-white/20 text-white hover:bg-white/30 disabled:opacity-50"
              >
                <CreditCard className="h-3.5 w-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={logoutStaff}
                className="h-10 w-10 text-white hover:bg-white/20"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          
          <aside className={cn(
            "hidden shrink-0 flex-col border-r border-emerald-200 bg-gradient-to-b from-emerald-50 to-white transition-[width] duration-300 md:flex overflow-hidden",
            showCategorySidebar ? "w-56" : "w-0 border-r-0"
          )}>
            <ScrollArea className="h-full w-56 p-3">
              <div className="flex flex-col gap-2">
                <Button
                  variant={activeCategory === "all" ? "default" : "outline"}
                  onClick={() => setActiveCategory("all")}
                  className={cn(
                    "justify-start text-sm font-bold",
                    activeCategory === "all" && "bg-emerald-600 text-white"
                  )}
                >
                  <LayoutGrid className="mr-2 h-4 w-4" />
                  All Categories
                </Button>
                {visibleCategories.map(cat => (
                  <Button
                    key={cat.id}
                    variant={activeCategory === cat.name ? "default" : "outline"}
                    onClick={() => setActiveCategory(cat.name)}
                    className={cn(
                      "justify-start text-sm font-medium",
                      activeCategory === cat.name && "bg-emerald-600 text-white"
                    )}
                  >
                    <ServiceCategoryVisual
                      imageUrl={cat.image_url}
                      iconName={inferServiceCategoryIcon(cat.name)}
                      label={cat.label}
                      className="mr-2 h-6 w-6 shrink-0 rounded-md"
                    />
                    {cat.label}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </aside>

          <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gradient-to-br from-slate-50 to-slate-100">
            
            <div className="md:hidden flex items-center gap-3 border-b-2 border-emerald-200 bg-emerald-50 px-4 py-3">
              <Button
                onClick={() => setShowTableDialog(true)}
                className="h-10 flex-1 gap-2 bg-emerald-600 text-white"
              >
                <LayoutGrid className="h-4 w-4" />
                {selectedTable ? `Table ${selectedTable.table_number}` : 'Select Table'}
              </Button>
            </div>

            {tables.length > 0 && (
              <div className="border-b-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-emerald-700" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Select Table</span>
                  <div className="ml-auto flex items-center gap-3 text-[10px] font-semibold">
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded bg-green-500"></div>
                      <span className="text-slate-600">FREE</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded bg-red-500"></div>
                      <span className="text-slate-600">BUSY</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded bg-emerald-600"></div>
                      <span className="text-slate-600">YOURS</span>
                    </div>
                  </div>
                </div>
               <ScrollArea className="w-full">
                  <div className="flex gap-2">
                    {tables.map((table) => {
                      const isSelected = selectedTable?.id === table.id;
                      const isOccupied = table.status === 'occupied';
                      const isOwnedByMe = !!getActiveOrderForTable(table.id);
                      const isAvailable = !isOccupied || isOwnedByMe;
                      const showAsYours = isSelected || (isOccupied && isOwnedByMe);
                      
                      return (
                        <Button
                          key={table.id}
                          variant={showAsYours ? "default" : "outline"}
                          onClick={() => isAvailable && handleSelectTable(table)}
                          disabled={isOccupied && !isOwnedByMe && !isSelected}
                          className={cn(
                            "h-16 min-w-[75px] flex-col gap-1 relative transition-all",
                            showAsYours && "bg-emerald-600 text-white shadow-lg scale-105 border-emerald-700",
                            !showAsYours && isAvailable && "bg-white hover:bg-green-50 hover:border-green-400 hover:shadow-md border-green-200 text-green-700",
                            isOccupied && !showAsYours && "bg-red-50 border-red-300 text-red-400 opacity-60 cursor-not-allowed"
                          )}
                        >
                          {showAsYours && (
                            <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white flex items-center justify-center shadow-md border-2 border-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            </div>
                          )}
                          {isOccupied && !showAsYours && (
                            <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 flex items-center justify-center">
                              <X className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                          <span className="text-base font-bold">{table.table_number}</span>
                          <span className="text-[9px] uppercase font-bold tracking-wide">
                            {showAsYours ? '✓ YOURS' : isOccupied ? '✗ BUSY' : '○ FREE'}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="flex items-center gap-3 border-b border-emerald-200 bg-white px-4 py-3">
              <Button
                variant="outline"
                size="icon"
                onClick={toggleCategorySidebar}
                className="h-10 w-10 shrink-0 border-emerald-300 bg-white hover:bg-emerald-50"
                title="Toggle categories"
              >
                <LayoutGrid className="h-4 w-4 text-emerald-700" />
              </Button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="🔍 Search..."
                  className="h-10 pl-10 border-2 border-emerald-200 focus:border-emerald-400"
                />
              </div>
              <span className="text-sm font-bold text-emerald-700">{filteredServices.length}</span>
            </div>

            <ScrollArea className="flex-1 p-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6">
                {filteredServices.map(service => {
                  const outOfStock = isOutOfStock(service);
                  const activePrice = getActiveServicePrice(service);
                  const disabled = !selectedTable || outOfStock;

                  return (
                    <Card
                      key={service.id}
                      onClick={() => !disabled && addToCart(service, 1)}
                      className={cn(
                        "flex h-full min-h-[120px] flex-col rounded-lg border-2 p-3 transition-all cursor-pointer",
                        disabled
                          ? "border-slate-200 bg-slate-100 opacity-60 cursor-not-allowed"
                          : "border-emerald-200 bg-white hover:border-emerald-400 hover:shadow-lg"
                      )}
                    >
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <ServiceCategoryVisual
                          imageUrl={categoryImageMap[normalizeServiceCategoryName(service.category)]}
                          iconName={inferServiceCategoryIcon(service.category)}
                          label={service.category}
                          className="h-8 w-8 rounded-md"
                        />
                        {outOfStock && (
                          <Badge variant="secondary" className="bg-rose-100 text-rose-700 text-[10px]">
                            Out of Stock
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col py-2">
                        <h3 className="text-sm font-semibold line-clamp-2 text-slate-900">{service.name}</h3>
                        <p className="mt-1 text-xs text-slate-500 line-clamp-2">{service.description}</p>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                        <span className={cn("text-lg font-bold", disabled ? "text-slate-500" : "text-emerald-700")}>
                          {formatCurrency(activePrice)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          disabled={disabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!disabled) addToCart(service, 1);
                          }}
                          className={cn(
                            "h-8 w-8 p-0",
                            disabled ? "bg-slate-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700"
                          )}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </section>

          <aside className="relative z-20 hidden w-[320px] shrink-0 flex-col border-l-2 border-emerald-200 bg-white lg:flex">
            <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as any)} className="flex h-full flex-col">
              <TabsList className="grid w-full grid-cols-2 bg-emerald-50">
                <TabsTrigger value="cart" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Cart ({cart.length})
                </TabsTrigger>
                <TabsTrigger value="orders" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                  <ClipboardList className="h-4 w-4 mr-2" />
                  My Orders ({myOrders.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="cart" className="flex-1 overflow-hidden p-0 m-0">
                <ScrollArea className="h-full p-3">
                  {cart.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                      <ShoppingBag className="mb-4 h-16 w-16 opacity-30" />
                      <p className="font-semibold text-slate-600">Cart is empty</p>
                      {!selectedTable && (
                        <p className="mt-2 text-xs text-slate-500">Select a table to start</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <CartItems
                        cart={cart}
                        updateQuantity={updateQuantity}
                        removeFromCart={removeFromCart}
                        itemNotes={{}}
                        setItemNotes={() => {}}
                        orderNotes={orderNotes}
                        setOrderNotes={setOrderNotes}
                        formatCurrency={formatCurrency}
                        categoryImages={categoryImageMap}
                      />
                      <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-semibold">Subtotal:</span>
                          <span className="font-bold">{formatCurrency(subtotal)}</span>
                        </div>
                        {discount > 0 && (
                          <div className="flex justify-between text-sm text-emerald-600">
                            <span>Discount ({discount}%):</span>
                            <span>-{formatCurrency(discountAmount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-lg font-bold border-t-2 border-emerald-200 pt-2">
                          <span>Total:</span>
                          <span className="text-emerald-700">{formatCurrency(total)}</span>
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button
                            onClick={handlePlaceOrder}
                            disabled={cart.length === 0 || isProcessing || !selectedTable}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                          >
                            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                            Send Order
                          </Button>
                          <Button
                            onClick={() => setShowPaymentDialog(true)}
                            disabled={cart.length === 0 || isProcessing}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            <Receipt className="h-4 w-4 mr-2" />
                            Pay & Send
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="orders" className="flex-1 overflow-hidden p-0 m-0">
                <ScrollArea className="h-full p-3">
                  {myOrders.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                      <ClipboardList className="mb-4 h-16 w-16 opacity-30" />
                      <p className="font-semibold text-slate-600">No orders yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myOrders.map((order: any) => (
                        <Card key={order.id} className="p-3 border-2 border-emerald-200">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-slate-900">Table {order.table_number}</h3>
                                <StatusBadge status={order.status} />
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                {new Date(order.created_at).toLocaleTimeString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-bold text-emerald-700">{formatCurrency(order.total_amount)}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between text-sm text-slate-600 mb-3">
                            <span>{order.items?.length || 0} items</span>
                            {order.payment_status === 'paid' && (
                              <Badge className="bg-green-100 text-green-700">
                                <Check className="h-3 w-3 mr-1" />
                                Paid
                              </Badge>
                            )}
                          </div>

                          <div className="flex gap-2">
                            {order.status !== 'billed' &&
                              order.status !== 'cancelled' &&
                              order.status !== 'pending_handover' &&
                              order.status !== 'awaiting_approval' &&
                              order.status !== 'settled' && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => openCollectPayment(order)}
                                  disabled={isProcessing}
                                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                                >
                                  <Wallet className="h-3 w-3 mr-1" />
                                  Send to Cashier
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openEditOrder(order)}
                                  disabled={isProcessing}
                                  className="border-blue-300 text-blue-600 hover:bg-blue-50"
                                >
                                  <ClipboardList className="h-3 w-3 mr-1" />
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelOrder(order.id)}
                                  disabled={isProcessing}
                                  className="text-red-600 border-red-300 hover:bg-red-50"
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Cancel
                                </Button>
                              </>
                            )}
                            {(order.status === 'pending_handover' || order.status === 'awaiting_approval') && (
                              <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-purple-600">
                                <Clock className="h-3.5 w-3.5" />
                                Waiting on cashier
                              </div>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </aside>
        </main>

        <div className="fixed bottom-5 right-5 z-50 flex gap-3 lg:hidden">
          <Button
            size="lg"
            onClick={() => setRightTab(rightTab === 'cart' ? 'orders' : 'cart')}
            className="h-14 w-14 rounded-full bg-emerald-600 text-white shadow-xl"
          >
            {rightTab === 'cart' ? <ClipboardList className="h-6 w-6" /> : <ShoppingCart className="h-6 w-6" />}
          </Button>
        </div>

        <Dialog open={showTableDialog} onOpenChange={setShowTableDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Select Table</DialogTitle>
              <DialogDescription>
                Choose a table to start taking orders
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[400px]">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {tables.map((table) => {
                  const isSelected = selectedTable?.id === table.id;
                  const isOccupied = table.status === 'occupied';
                  const isOwnedByMe = !!getActiveOrderForTable(table.id);
                  const isAvailable = table.status === 'available' || table.status === 'free' || isOwnedByMe;
                  const showAsYours = isSelected || (isOccupied && isOwnedByMe);
                  
                  return (
                    <Button
                      key={table.id}
                      variant={showAsYours ? "default" : "outline"}
                      onClick={() => isAvailable && handleSelectTable(table)}
                      disabled={isOccupied && !isOwnedByMe && !isSelected}
                      className={cn(
                        "h-24 flex-col gap-1 relative",
                        showAsYours && "bg-emerald-600 text-white shadow-lg",
                        isOccupied && !showAsYours && "border-red-300 bg-red-50 text-red-400 cursor-not-allowed opacity-50"
                      )}
                    >
                      {showAsYours && (
                        <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-white flex items-center justify-center">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </div>
                      )}
                      <span className="text-xl font-bold">{table.table_number}</span>
                      <span className="text-[10px] uppercase font-semibold">
                        {showAsYours ? 'YOUR TABLE' : isOccupied ? 'OCCUPIED' : 'AVAILABLE'}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Process Payment</DialogTitle>
              <DialogDescription>
                Total: {formatCurrency(total)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold">Payment Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'cash', label: 'Cash', icon: '💵' },
                    { id: 'card', label: 'Card', icon: '💳' },
                    { id: 'momo', label: 'Momo', icon: '📱' },
                    { id: 'split', label: 'Split', icon: '➗' },
                  ].map((method) => (
                    <Button
                      key={method.id}
                      variant={paymentMethod === method.id ? "default" : "outline"}
                      onClick={() => setPaymentMethod(method.id as any)}
                      className={paymentMethod === method.id ? "bg-emerald-600" : ""}
                    >
                      <span className="mr-2">{method.icon}</span>
                      {method.label}
                    </Button>
                  ))}
                </div>
              </div>
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                onClick={handlePayment}
                disabled={isProcessing || cart.length === 0}
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Pay {formatCurrency(total)} & Send
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showMonitor} onOpenChange={setShowMonitor}>
          <DialogContent className="
            flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden
            border-0 bg-background p-0
            sm:h-[92dvh] sm:w-[96vw] sm:max-w-5xl
            sm:rounded-2xl sm:border sm:border-border/60
            sm:shadow-2xl sm:shadow-black/10
          ">
            <div className="relative shrink-0 border-b border-border/60 bg-background px-4 py-3.5 sm:px-6 sm:py-4">
              <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400" />
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 text-base font-semibold sm:text-lg">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100">
                    <Monitor className="h-4 w-4 text-emerald-600" />
                  </span>
                  Active Orders Monitor
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                  {monitorOrders.length} active order{monitorOrders.length !== 1 ? 's' : ''} across all waiters
                </DialogDescription>
              </DialogHeader>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4 sm:p-6">
                {monitorOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-200/60 bg-emerald-50">
                      <ClipboardList className="h-7 w-7 text-emerald-500" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">No active orders</p>
                    <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                      All orders have been processed or there are no orders yet.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        refetchMonitor();
                        toast.success('Refreshing orders...');
                      }}
                      className="mt-6 h-8 rounded-lg border-border/60 text-xs font-semibold"
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Refresh
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {monitorOrders.map((order: any) => {
                      const isBilledOrPaid =
                        order.status === 'billed' ||
                        order.status === 'settled' ||
                        order.status === 'cancelled';
                      const isAwaitingCashier =
                        order.status === 'pending_handover' || order.status === 'awaiting_approval';
                      const items = order.items || [];
                      const activeItems = items.filter((item: any) => item.status !== 'cancelled');
                      const hasKitchen = activeItems.some((item: any) => item.station === 'kitchen');
                      const hasBar = activeItems.some((item: any) => item.station === 'bar');

                      return (
                        <Card
                          key={order.id}
                          className={cn(
                            "flex flex-col overflow-hidden border-2 transition-all hover:shadow-md",
                            order.status === 'billed' || order.status === 'settled'
                              ? "border-emerald-200 bg-emerald-50/30"
                              : order.status === 'cancelled'
                                ? "border-red-200 bg-red-50/30"
                                : isAwaitingCashier
                                  ? "border-purple-200 bg-purple-50/30"
                                  : "border-slate-200 bg-white"
                          )}
                        >
                          <div className="flex items-start justify-between border-b border-slate-100 p-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-slate-900">
                                  {order.table_number ? `Table ${order.table_number}` : 'Takeaway'}
                                </h3>
                                <StatusBadge status={order.status} />
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                                <span className="flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  {order.waiter_name || 'Unknown'}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {new Date(order.created_at).toLocaleTimeString()}
                                </span>
                                {hasKitchen && (
                                  <span className="flex items-center gap-1 text-amber-600">
                                    <ChefHat className="h-3 w-3" />
                                    KTN
                                  </span>
                                )}
                                {hasBar && (
                                  <span className="flex items-center gap-1 text-blue-600">
                                    <GlassWater className="h-3 w-3" />
                                    BAR
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <p className="text-lg font-bold text-emerald-700">{formatCurrency(order.total_amount)}</p>
                              <p className="text-[10px] text-slate-500">{activeItems.length} item{activeItems.length !== 1 ? 's' : ''}</p>
                            </div>
                          </div>

                          <div className="flex-1 p-3 space-y-1">
                            {activeItems.length === 0 ? (
                              <p className="text-[11px] text-slate-400 italic">No active items</p>
                            ) : (
                              activeItems.slice(0, 5).map((item: any, idx: number) => (
                                <div key={item.id || idx} className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-700 truncate">
                                    <span className="font-semibold text-slate-900">{item.quantity}×</span> {item.name}
                                  </span>
                                  <span className="font-semibold text-slate-700 ml-2 shrink-0">
                                    {formatCurrency(Number(item.unit_price) * Number(item.quantity))}
                                  </span>
                                </div>
                              ))
                            )}
                            {activeItems.length > 5 && (
                              <p className="text-[10px] text-slate-400 font-medium">
                                +{activeItems.length - 5} more items
                              </p>
                            )}
                          </div>

                          <div className="border-t border-slate-100 p-3">
                            {isBilledOrPaid ? (
                              <div className="flex items-center justify-center gap-2 py-1 text-[11px] font-semibold text-emerald-600">
                                <CheckCircle2 className="h-4 w-4" />
                                {order.status === 'settled' ? 'Settled' : order.status === 'cancelled' ? 'Cancelled' : 'Billed'}
                              </div>
                            ) : isAwaitingCashier ? (
                              <div className="flex items-center justify-center gap-2 py-1 text-[11px] font-semibold text-purple-600">
                                <Clock className="h-4 w-4" />
                                Sent to cashier — awaiting settlement
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => openCollectPayment(order)}
                                  disabled={isProcessing}
                                  className="h-8 flex-1 gap-1 text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700"
                                >
                                  <Wallet className="h-3.5 w-3.5" />
                                  Send to Cashier
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openSplitBill(order)}
                                  disabled={isProcessing}
                                  className="h-8 gap-1 text-[10px] font-semibold border-violet-300 text-violet-700 hover:bg-violet-50"
                                >
                                  <SplitSquareHorizontal className="h-3.5 w-3.5" />
                                  Split
                                </Button>
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="flex shrink-0 items-center justify-end border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    refetchMonitor();
                    toast.success('Refreshing...');
                  }}
                  className="h-8 gap-1.5 rounded-lg border-border/60 text-xs font-semibold"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMonitor(false)}
                  className="h-8 rounded-lg px-5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showPaymentCollectDialog} onOpenChange={(open) => {
          if (!open) {
            setShowPaymentCollectDialog(false);
            setCollectingOrder(null);
            setSelectedCustomer(null);
          }
        }}>
          <DialogContent className="overflow-hidden rounded-xl border border-slate-300 bg-white p-0 shadow-2xl sm:max-w-[420px]">
            <div className="border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-base font-bold uppercase tracking-[0.08em] text-slate-900">Send to Cashier</DialogTitle>
                  <DialogDescription className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                    {collectingOrder && (
                      <>Order #{collectingOrder.order_number?.toString().slice(-4) || ''} • Total: {formatCurrency(collectingOrder.total_amount)}</>
                    )}
                  </DialogDescription>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50">
                  <Wallet className="h-5 w-5 text-emerald-600" />
                </div>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <p className="text-xs text-slate-500">
                Confirm the payment method you collected. This sends the order to the cashier for approval —
                it isn't marked as settled until they confirm receipt.
              </p>

              <div className="space-y-2">
                <Label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Customer (Optional)</Label>
                <Button
                  variant="outline"
                  onClick={() => setShowCustomerSelector(true)}
                  className="flex w-full items-center justify-between border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 h-auto"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate text-xs font-medium">
                      {selectedCustomer ? selectedCustomer.name : "Walk-in Guest"}
                    </span>
                  </div>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </Button>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Payment Method</Label>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map((method) => (
                    <Button
                      key={method.id}
                      variant={paymentMethod === method.id ? "default" : "outline"}
                      onClick={() => setPaymentMethod(method.id)}
                      className={cn(
                        "h-10 gap-2 text-xs font-semibold",
                        paymentMethod === method.id
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : "border-slate-200 hover:border-emerald-300 hover:bg-emerald-50"
                      )}
                    >
                      <method.icon className="h-4 w-4" />
                      {method.label}
                    </Button>
                  ))}
                </div>
              </div>

              {collectingOrder && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Items</span>
                    <span className="font-semibold text-slate-700">
                      {(collectingOrder.items || []).filter((i: any) => i.status !== 'cancelled').length} items
                    </span>
                  </div>
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-500">Total Amount</span>
                    <span className="text-emerald-700">{formatCurrency(collectingOrder.total_amount)}</span>
                  </div>
                </div>
              )}

              <Button
                onClick={handleCollectPayment}
                disabled={isProcessing}
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-xs font-bold uppercase tracking-[0.12em] text-white shadow-md hover:bg-emerald-700 disabled:opacity-50"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {isProcessing ? 'Submitting...' : `Send ${formatCurrency(collectingOrder?.total_amount || 0)} to Cashier`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showEditOrderDialog} onOpenChange={(open) => {
          setShowEditOrderDialog(open);
          if (!open) setEditingOrder(null);
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                Edit Order {liveEditingOrder ? `— Table ${liveEditingOrder.table_number}` : ''}
              </DialogTitle>
              <DialogDescription>
                Adjust quantities or remove items. Saved instantly to the order.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[360px]">
              <div className="space-y-2">
                {(liveEditingOrder?.items || [])
                  .filter((i: any) => i.status !== 'cancelled')
                  .map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">{formatCurrency(item.unit_price)} each</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          disabled={updateOrderItemQuantity.isPending}
                          onClick={() => handleEditQtyChange(item, Number(item.quantity) - 1)}
                        >
                          -
                        </Button>
                        <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          disabled={updateOrderItemQuantity.isPending}
                          onClick={() => handleEditQtyChange(item, Number(item.quantity) + 1)}
                        >
                          +
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-500"
                          disabled={cancelOrderItem.isPending}
                          onClick={() => handleRemoveEditItem(item)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between border-t pt-3 text-sm font-bold">
              <span>Order Total</span>
              <span className="text-emerald-700">{formatCurrency(liveEditingOrder?.total_amount || 0)}</span>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showOrderChoiceDialog} onOpenChange={setShowOrderChoiceDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                Table {selectedTable?.table_number} already has an order
              </DialogTitle>
              <DialogDescription>
                Are these items for the same bill, or is this a different customer starting a new order?
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 pt-2">
              <Button
                onClick={handleConfirmAddToExistingOrder}
                disabled={isProcessing}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Add to Existing Order
              </Button>
              <Button
                onClick={handleConfirmStartNewOrder}
                disabled={isProcessing}
                variant="outline"
                className="w-full border-blue-300 text-blue-600 hover:bg-blue-50"
              >
                <Plus className="h-4 w-4 mr-2" />
                Start New Order (New Customer)
              </Button>
              <Button
                onClick={() => setShowOrderChoiceDialog(false)}
                variant="ghost"
                className="w-full text-slate-500"
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {splitBillOrder && (
          <SplitBillDialog
            open={showSplitBillDialog}
            onOpenChange={(open) => {
              setShowSplitBillDialog(open);
              if (!open) {
                setSplitBillOrder(null);
              }
            }}
            order={splitBillOrder}
            formatCurrency={formatCurrency}
            activeStaff={activeStaff}
            activeShift={activeShift}
            onComplete={handleSplitBillComplete}
          />
        )}

        <HotelCustomerSelectorDialog
          open={showCustomerSelector}
          onOpenChange={setShowCustomerSelector}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={(customer) => {
            setSelectedCustomer(customer);
            setShowCustomerSelector(false);
          }}
        />

        {currentKOT && (
          <KOTPrint
            key={`${currentKOT.station}-${currentKOT.orderNumber}-${currentKOT.type || 'new'}-${currentKOT.timestamp.getTime()}`}
            data={currentKOT}
            onPrintComplete={handlePrintComplete}
          />
        )}

        {receiptData && (
          <HotelReceiptPrint
            key={receiptData.invoiceNumber || Date.now()}
            {...receiptData}
            onPrintComplete={() => setReceiptData(null)}
          />
        )}
      </div>
    </Layout>
  );
}