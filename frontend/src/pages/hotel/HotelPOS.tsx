import React from "react";
import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { unstable_batchedUpdates } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { useAvailableServices, ServiceMenuItem, getActiveServicePrice, isLowStock, isOutOfStock } from "@/hooks/useServiceMenu";
import { useActiveServiceCategories } from "@/hooks/useServiceCategories";
import { useHotelPOS, HotelPOSPayment, HotelCartItem } from "@/hooks/useHotelPOS";
import { useOrderTemplates } from "@/hooks/useOrderTemplates";
import { usePlaceOrder, useWaiterOrders, useBillOrders, useUpdateOrderStatus, useAddItemsToOrder, useTableOccupancyOrders, useMonitorOrders, useUpcomingReservations } from "@/hooks/useHotelOrders";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { apiClient } from "@/integrations/supabase/client";
import { HotelReceiptPrint, type HotelReceiptPrintItem } from "@/components/hotel/HotelReceiptPrint";
import { KOTPrint, type KOTData } from "@/components/hotel/KOTPrint";
import { CloseShiftDialog } from "@/components/hotel/CloseShiftDialog";
import { useHotelInfo } from "@/hooks/useHotel";
import { OpenShiftDialog } from "@/components/hotel/OpenShiftDialog";
import { ManagerAuthDialog } from "@/components/hotel/ManagerAuthDialog";
import type { HotelOrder, HotelTable, HotelTableSessionSeat, HotelTableStatus } from "@/types/hotel";
import { useHotelTables, useUpdateHotelTableStatus } from "@/hooks/useHotelTables";
import { useCustomers, type Customer } from "@/hooks/useCustomers";
import { resetBackendReachable } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { useActiveStaffShift, useOpenStaffShift } from "@/hooks/useHotelShifts";
import { getLocalData } from "@/lib/localDataService";
import {
  canAccessHotelOrder,
  canManageHotelOrder,
  canManageHotelTable,
  clearWaiterPosAccess,
  getEffectiveHotelTableStatus,
  grantWaiterPosAccess,
  isManagerLikeStaff,
  isTableOccupyingOrderStatus,
  isWaiterStaff,
} from "@/lib/hotelAccess";
import {
  Search, Plus, Minus, Trash2, CreditCard, Banknote,
  Smartphone, Building2, Receipt, Printer, X, User, Users, Clock,
  ShoppingBag, Loader2,
  CheckCircle2, Package, Zap, SplitSquareHorizontal, Send,
  ClipboardList, MessageSquare, Bell, ChefHat, FileText,
  LayoutGrid, List, Filter, ShoppingCart, ArrowRight, Monitor,
  Sparkle, Flame, IceCream, Pizza, Beer, Layers, Lock, LogOut, RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CartItems } from "./components/CartItems";
import { ActiveOrders } from "./components/ActiveOrders";
import { CashierSettlements } from "./components/CashierSettlements";

import { TableStatusScene } from "@/components/hotel/TableStatusScene";
import { HotelCustomerSelectorDialog } from "@/components/hotel/HotelCustomerSelectorDialog";
import { ServiceCategoryVisual } from "@/components/hotel/ServiceCategoryVisual";
import { useActiveTableSession, useOpenHotelTableSession } from "@/hooks/useHotelTableSessions";
import {
  formatServiceCategoryLabel,
  inferServiceCategoryStation,
  inferServiceCategoryIcon,
  normalizeServiceCategoryName,
  resolveServiceCategoryStation,
} from "@/lib/serviceCategoryUtils";
import { getOrderBalanceDue, getReservationDepositCredit } from "@/lib/hotelReservationUtils";

const normalizeTableNumber = (value?: string | null) => (value || "").trim().toUpperCase();

function isRealUuid(v?: string | null) {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const getInitials = (name?: string | null) =>
  (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

const orderStatusConfig: Record<string, { label: string; color: string; glow: string }> = {
  pending: { label: "PENDING", color: "text-slate-600", glow: "shadow-slate-200/50" },
  preparing: { label: "PREPARING", color: "text-amber-600", glow: "shadow-amber-200/50" },
  ready: { label: "READY", color: "text-emerald-600", glow: "shadow-emerald-200/50" },
  served: { label: "SERVED", color: "text-blue-600", glow: "shadow-blue-200/50" },
  awaiting_approval: { label: "WAITING APPROVAL", color: "text-amber-500 animate-pulse", glow: "shadow-amber-300/50" },
  pending_handover: { label: "PENDING HANDOVER", color: "text-amber-500 animate-pulse", glow: "shadow-amber-300/50" },
  confirmed: { label: "CONFIRMED", color: "text-teal-600", glow: "shadow-teal-300/50" },
  paid: { label: "PAID", color: "text-purple-600", glow: "shadow-purple-200/50" },
  settled: { label: "SETTLED", color: "text-emerald-700", glow: "shadow-emerald-300/50" },
  cancelled: { label: "CANCELLED", color: "text-slate-400", glow: "shadow-slate-100/50" },
  billed: { label: "BILLED", color: "text-indigo-600", glow: "shadow-indigo-200/50" },
};

const tableStatusStyles: Record<HotelTableStatus, string> = {
  free: "border-emerald-200 bg-emerald-50 text-emerald-700",
  reserved: "border-amber-200 bg-amber-50 text-amber-700",
  occupied: "border-rose-200 bg-rose-50 text-rose-700",
  cleaning: "border-slate-200 bg-slate-100 text-slate-700",
};

const tableCardStyles: Record<HotelTableStatus, string> = {
  free: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50",
  reserved: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50",
  occupied: "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50",
  cleaning: "border-slate-200 bg-gradient-to-br from-slate-100 via-white to-slate-50",
};

const TABLE_CLEANING_DURATION_MS = 60 * 1000;

function inferStoredOrderTaxRate(order: Pick<HotelOrder, "subtotal" | "discount_amount" | "tax_amount" | "total_amount">) {
  const subtotal = Number(order.subtotal || 0);
  const discountAmount = Number(order.discount_amount || 0);
  const taxAmount = Number(order.tax_amount || 0);
  const totalAmount = Number(order.total_amount || 0);
  const discountedSubtotal = Number(Math.max(0, subtotal - discountAmount).toFixed(2));
  const taxInclusive = Math.abs(totalAmount - discountedSubtotal) < 0.02;

  if (taxInclusive) {
    const untaxedAmount = Math.max(0, totalAmount - taxAmount);
    return untaxedAmount > 0 ? Number(((taxAmount / untaxedAmount) * 100).toFixed(2)) : 0;
  }

  return discountedSubtotal > 0 ? Number(((taxAmount / discountedSubtotal) * 100).toFixed(2)) : 0;
}

function buildReceiptItemsFromOrder(order: HotelOrder): HotelReceiptPrintItem[] {
  return (order.items || [])
    .filter((item) => item.status !== "cancelled")
    .map((item) => ({
      service: {
        name: item.name,
      },
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
    }));
}

function calculateOrderTotals(
  subtotal: number,
  discountAmount: number,
  taxRate: number,
  taxInclusive: boolean
) {
  const normalizedSubtotal = Number(subtotal.toFixed(2));
  const normalizedDiscount = Number(discountAmount.toFixed(2));

  if (taxInclusive) {
    const totalAmount = Number(Math.max(0, normalizedSubtotal - normalizedDiscount).toFixed(2));
    const taxAmount = Number((totalAmount * (taxRate / (100 + taxRate))).toFixed(2));
    return {
      subtotal: normalizedSubtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
    };
  }

  const taxableAmount = Number(Math.max(0, normalizedSubtotal - normalizedDiscount).toFixed(2));
  const taxAmount = Number((taxableAmount * (taxRate / 100)).toFixed(2));
  const totalAmount = Number((taxableAmount + taxAmount).toFixed(2));

  return {
    subtotal: normalizedSubtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
  };
}

function getCleaningRemainingMs(table: HotelTable, now: number) {
  const startedAt = table.cleaning_started_at || table.updated_at || table.created_at;
  return Math.max(0, TABLE_CLEANING_DURATION_MS - (now - new Date(startedAt).getTime()));
}

function getCleaningCountdown(table: HotelTable, now: number) {
  const remainingMs = getCleaningRemainingMs(table, now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type PaymentMethodType = 'cash' | 'card' | 'upi' | 'bank_transfer' | 'momo';

const PAYMENT_METHOD_OPTIONS: PaymentMethodType[] = ['cash', 'card', 'upi', 'bank_transfer', 'momo'];

const normalizePaymentMethod = (value?: string | null): PaymentMethodType =>
  PAYMENT_METHOD_OPTIONS.includes((value || '') as PaymentMethodType)
    ? (value as PaymentMethodType)
    : 'cash';

interface SplitPayment {
  method: PaymentMethodType;
  amount: number;
}

const ServiceCard = memo(({ service, cartItem, addToCart, formatCurrency, categoryIconName, categoryImageUrl }: { 
  service: ServiceMenuItem; 
  cartItem?: HotelCartItem; 
  addToCart: (s: ServiceMenuItem) => void;
  formatCurrency: (v: number) => string;
  categoryIconName?: string | null;
  categoryImageUrl?: string | null;
}) => {
  const outOfStock = isOutOfStock(service);
  const lowStock = isLowStock(service);
  const activePrice = getActiveServicePrice(service);
  const hasSpecialPrice = activePrice !== service.selling_price;

  return (
    <div 
      onClick={() => addToCart(service)}
      className={cn(
        "group relative flex h-full min-h-[148px] flex-col overflow-hidden rounded-md border border-slate-300 bg-white cursor-pointer",
        "transition-all duration-150 active:scale-[0.99] touch-manipulation shadow-sm",
        "hover:border-rose-200 hover:shadow-[0_4px_14px_rgba(148,163,184,0.12)]",
        cartItem && "border-rose-300 bg-rose-50/70 shadow-[inset_3px_0_0_theme(colors.rose.400)]",
        outOfStock && "border-amber-300 bg-amber-50/40"
      )}
    >
      <div className="flex items-start justify-between border-b border-slate-200 bg-slate-100 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <ServiceCategoryVisual
            imageUrl={categoryImageUrl}
            iconName={categoryIconName || inferServiceCategoryIcon(service.category)}
            label={formatServiceCategoryLabel(service.category)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm ring-1"
            iconClassName="h-4 w-4"
          />
          <div className="min-w-0">
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {formatServiceCategoryLabel(service.category)}
            </p>
            {service.track_stock && (
              <p className={cn(
                "text-[10px] font-medium",
                outOfStock ? "text-rose-600" : lowStock ? "text-amber-600" : "text-slate-500"
              )}>
                {outOfStock ? `Stock warning: ${service.stock_quantity}` : `Stock: ${service.stock_quantity}`}
              </p>
            )}
          </div>
        </div>

        {service.track_stock && lowStock && !outOfStock && (
          <Badge variant="secondary" className="h-5 rounded-sm border-0 bg-amber-100 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
            Low
          </Badge>
        )}
        
        {hasSpecialPrice && (
          <Badge className="h-5 rounded-sm border-0 bg-rose-500 px-1.5 text-[9px] font-black uppercase tracking-wide text-white animate-pulse">
            SALE
          </Badge>
        )}
      </div>

      {cartItem && (
        <div className="absolute right-2 top-2 z-20">
          <div className="flex h-5 min-w-5 items-center justify-center rounded-sm bg-rose-400 px-1.5 text-[10px] font-bold text-white shadow-sm">
            {cartItem.quantity}
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col p-2.5">
        <div className="flex-1 space-y-1">
          <h3 className="line-clamp-2 text-[13px] font-semibold leading-4.5 text-slate-900">
            {service.name}
          </h3>
          <p className="line-clamp-2 min-h-7 text-[11px] leading-4 text-slate-500">
            {service.description?.trim() || ""}
          </p>
        </div>

        <div className="mt-2.5 flex items-end justify-between gap-2 border-t border-slate-200 pt-2.5">
          <div className="min-w-0">
            <div className="flex flex-col">
              {hasSpecialPrice && (
                <span className="text-[10px] text-slate-400 line-through decoration-rose-300">
                  {formatCurrency(service.selling_price)}
                </span>
              )}
              <span className={cn(
                "block text-base font-semibold leading-none tabular-nums",
                hasSpecialPrice ? "text-rose-600" : "text-slate-950"
              )}>
                {formatCurrency(activePrice)}
              </span>
            </div>
            <span className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
              <Package className="h-3 w-3" />
              {service.track_stock ? (outOfStock ? "Unavailable" : "Available") : "Made to order"}
            </span>
          </div>

          <Button
            type="button"
            size="sm"
            className={cn(
              "h-8 min-w-[68px] rounded-sm px-2.5 text-[11px] font-semibold shadow-none",
              cartItem
                ? "bg-rose-400 text-white hover:bg-rose-400"
                : "bg-violet-500 text-white hover:bg-violet-600",
              outOfStock && "bg-amber-500 text-white hover:bg-amber-500"
            )}
          >
            {cartItem ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            {cartItem ? "Added" : "Add"}
          </Button>
        </div>
      </div>
    </div>
  );
});

ServiceCard.displayName = 'ServiceCard';

// --- MAIN POS COMPONENT ---

 function HotelPOS() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { formatCurrency, posSettings } = useSettingsContext();
  const { activeStaff, logoutStaff, activeShift, refreshActiveShift, verifyPinOnly, isShiftActive } = useStaffSession();
  // States
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [showMonitorDialog, setShowMonitorDialog] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>(
    normalizePaymentMethod(posSettings?.default_payment_method)
  );
  const [paidAmount, setPaidAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [rightTab, setRightTab] = useState<"cart" | "handoffs">("cart");
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [tableNumber, setTableNumber] = useState("");
  const [orderType, setOrderType] = useState<'takeaway' | 'delivery' | 'reservation'>('takeaway');
  const [reservationDate, setReservationDate] = useState("");
  const [reservationTime, setReservationTime] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [reservationCustomerName, setReservationCustomerName] = useState("");
  const [reservationCustomerPhone, setReservationCustomerPhone] = useState("");
  const [reservationCustomerAddress, setReservationCustomerAddress] = useState("");
  const [reservationAssignedWaiterId, setReservationAssignedWaiterId] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [addingToOrder, setAddingToOrder] = useState<HotelOrder | null>(null);
  const [showOpenShiftDialog, setShowOpenShiftDialog] = useState(false);
  const [showCloseShiftDialog, setShowCloseShiftDialog] = useState(false);
  const [showManagerAuth, setShowManagerAuth] = useState(false);
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [showOrderTypeDialog, setShowOrderTypeDialog] = useState(false);
  const [pendingOrderType, setPendingOrderType] = useState<'takeaway' | 'delivery' | 'reservation' | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [lastReceiptData, setLastReceiptData] = useState<any>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [kotQueue, setKotQueue] = useState<KOTData[]>([]);
  const currentKOT = useMemo(() => kotQueue[0] ?? null, [kotQueue]);
  const [selectedServiceTable, setSelectedServiceTable] = useState<HotelTable | null>(null);
  const [tableAccessPin, setTableAccessPin] = useState("");
  const [isUnlockingPOS, setIsUnlockingPOS] = useState(false);
  const [posAccessGranted, setPosAccessGranted] = useState(false);
  const [showTablePinDialog, setShowTablePinDialog] = useState(false);
  const [tableCountdownNow, setTableCountdownNow] = useState(Date.now());
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  const directPaymentOperationKeyRef = useRef<string | null>(null);
  const waiterPosAccessExpiryMs = 8 * 60 * 60 * 1000;

  // ─── POS Handle — intake workflows (takeaway / delivery / reservation) ───
  const [takeawayCustomerName, setTakeawayCustomerName] = useState("");
  const [takeawayCustomerPhone, setTakeawayCustomerPhone] = useState("");
  const [takeawayPaymentPlan, setTakeawayPaymentPlan] = useState<'full' | 'partial' | 'later'>('later');
  const [takeawayPartialAmount, setTakeawayPartialAmount] = useState("");

  const [deliveryCustomerName, setDeliveryCustomerName] = useState("");
  // deliveryPhone / deliveryAddress already exist above
  const [deliveryPaymentPlan, setDeliveryPaymentPlan] = useState<'full' | 'partial' | 'later'>('later');
  const [deliveryPartialAmount, setDeliveryPartialAmount] = useState("");

  const [reservationDeposit, setReservationDeposit] = useState("");

  // When a customer is selected via the customer dialog while the order type dialog is open,
  // pre-fill the workflow-specific fields
  useEffect(() => {
    if (!selectedCustomer) return;
    if (!pendingOrderType) return;

    if (pendingOrderType === 'takeaway') {
      setTakeawayCustomerName(selectedCustomer.name || "");
      setTakeawayCustomerPhone(selectedCustomer.phone || "");
    } else if (pendingOrderType === 'delivery') {
      setDeliveryCustomerName(selectedCustomer.name || "");
      setDeliveryPhone(selectedCustomer.phone || "");
      if (selectedCustomer.address) setDeliveryAddress(selectedCustomer.address);
    } else if (pendingOrderType === 'reservation') {
      setReservationCustomerName(selectedCustomer.name || "");
      setReservationCustomerPhone(selectedCustomer.phone || "");
      if (selectedCustomer.address) setReservationCustomerAddress(selectedCustomer.address);
    }
  }, [selectedCustomer, pendingOrderType]);

 

  const hasPendingTableEntry = useMemo(() => {
    const state = location.state as { tableEntry?: { tableId?: string; tableNumber?: string; staffId?: string } } | null;
    if (state?.tableEntry) return true;
    try {
      // Check for navigation entry
      const storedEntry = sessionStorage.getItem("waiterTableEntry");
      if (storedEntry) {
        const parsed = JSON.parse(storedEntry);
        const grantedAt = typeof parsed?.grantedAt === "number" ? parsed.grantedAt : 0;
        const isExpired = grantedAt > 0 && Date.now() - grantedAt > waiterPosAccessExpiryMs;
        if (parsed?.tableId && !isExpired) return true;
      }
      
      // Check for persistent POS access (e.g. after refresh)
      const posAccess = sessionStorage.getItem("hotel.waiterPosAccess");
      if (posAccess) {
        const parsed = JSON.parse(posAccess);
        const isExpired =
          parsed?.grantedAt && (Date.now() - parsed.grantedAt > waiterPosAccessExpiryMs);
        if (parsed?.tableId && !isExpired) return true;
      }
    } catch {
      return false;
    }
    return false;
  }, [location.state, activeStaff?.staff_id, waiterPosAccessExpiryMs]);

  const requiresTableAccessGate = isWaiterStaff(activeStaff);
  const canAccessUnlockedPOS = !requiresTableAccessGate || posAccessGranted || hasPendingTableEntry;
  const tableRefetchIntervalMs = useMemo(() => {
    if (showMonitorDialog || showTablePinDialog || !canAccessUnlockedPOS) {
      return 10000;
    }

    if (!selectedServiceTable && !tableNumber) {
      return 15000;
    }

    return 30000;
  }, [canAccessUnlockedPOS, selectedServiceTable, showMonitorDialog, showTablePinDialog, tableNumber]);

  const { data: services = [], isLoading: servicesLoading } = useAvailableServices();
  const { data: categories = [] } = useActiveServiceCategories();
  const { data: tables = [] } = useHotelTables(false, {
    refetchIntervalMs: tableRefetchIntervalMs,
  });
  const { data: templates = [] } = useOrderTemplates();
  const placeOrder = usePlaceOrder();
  const updateTableStatus = useUpdateHotelTableStatus();
  const { data: upcomingReservations = [] } = useUpcomingReservations();
  const addItemsToOrder = useAddItemsToOrder();
  const openTableSession = useOpenHotelTableSession();
   const updateOrderStatus = useUpdateOrderStatus();
 
  const waiterId = activeStaff?.staff_id;
  const { data: activeReservationWaiters = [] } = useQuery({
    queryKey: ['hotel-pos-active-reservation-waiters'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_staff')
        .select('id, first_name, last_name, role')
        .eq('is_active', true)
        .in('role', ['waiter', 'waiter_admin'])
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60,
  });

  
   useEffect(() => {
    if (pendingOrderType !== 'reservation') return;

    if (reservationAssignedWaiterId) {
      const stillExists = activeReservationWaiters.some((waiter) => waiter.id === reservationAssignedWaiterId);
      if (stillExists) return;
    }

    const preferredWaiterId =
      (isWaiterStaff(activeStaff) ? activeStaff?.staff_id : null) ||
      activeReservationWaiters[0]?.id ||
      "";

    if (preferredWaiterId) {
      setReservationAssignedWaiterId(preferredWaiterId);
    }
  }, [activeStaff, activeReservationWaiters, pendingOrderType, reservationAssignedWaiterId]);



  const { data: myOrders = [] } = useWaiterOrders(waiterId);
  const scopedMyOrders = useMemo(() => {
    if (!activeStaff?.staff_id) {
      return [];
    }

    return myOrders.filter((order) => 
      canAccessHotelOrder(activeStaff, order) &&
      ['takeaway', 'delivery', 'reservation'].includes(order.order_type || '')
    );
  }, [activeStaff, myOrders]);
     const monitorOrdersEnabled = showMonitorDialog;


 const { data: monitorOrders = [] } = useMonitorOrders(monitorOrdersEnabled, {
  preferFresh: true,
  refetchIntervalMs: 5000,
});
  const openShift = useOpenStaffShift();
  const { data: hotelInfo } = useHotelInfo();
  const { findOrCreateCustomer } = useCustomers();


  const hotelTaxRate = hotelInfo?.tax_rate ?? 18;
   const hotelTaxInclusive = hotelInfo?.tax_inclusive ?? false;
 
   // Always allow actions! No shift check needed
   const canPerformActions = true;
const {
  cart, discount, subtotal, discountAmount,
  taxRate, taxAmount, total, addToCart, updateQuantity,
  removeFromCart, clearCart, setDiscount,
  processDirectPayment
} = useHotelPOS(hotelTaxRate, activeShift?.id, activeStaff?.staff_id, hotelTaxInclusive, categories);

   const occupancyOrdersEnabled =
  !canAccessUnlockedPOS ||
  showTablePinDialog ||
  showMonitorDialog ||
  !!selectedServiceTable ||
  !!tableNumber;
  const occupancyRefetchIntervalMs = useMemo(() => {
    if (!occupancyOrdersEnabled) {
      return false;
    }

    if (showMonitorDialog || showTablePinDialog || !canAccessUnlockedPOS) {
      return 15000;
    }

    if (selectedServiceTable || tableNumber) {
      return 45000;
    }

    return 30000;
  }, [canAccessUnlockedPOS, occupancyOrdersEnabled, selectedServiceTable, showMonitorDialog, showTablePinDialog, tableNumber]);
const { data: occupancyOrders = [] } = useTableOccupancyOrders(occupancyOrdersEnabled, {
  refetchIntervalMs: occupancyRefetchIntervalMs,
});

   // Always perform actions! No shift check
   const safeHandleAction = useCallback((action: () => void) => {
     action();
   }, []);
 
   // Real-time notifications for waiters
   const notifiedReady = useRef<Set<string>>(new Set());

   useEffect(() => {
     const readyOrders = scopedMyOrders.filter(o => o.kitchen_status === 'ready' || o.bar_status === 'ready');
     
     readyOrders.forEach(order => {
       const orderId = order.id;
       const kitchenKey = `${orderId}-kitchen-ready`;
       const barKey = `${orderId}-bar-ready`;

       if (order.kitchen_status === 'ready' && !notifiedReady.current.has(kitchenKey)) {
         toast.success(`KITCHEN READY: Order #${order.order_number.slice(-4)}`, {
           description: `Items for Room ${order.room?.room_number || order.table_number || 'WI'} are ready.`,
           duration: 5000,
         });
         new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(() => {});
         notifiedReady.current.add(kitchenKey);
       }

       if (order.bar_status === 'ready' && !notifiedReady.current.has(barKey)) {
         toast.info(`BAR READY: Order #${order.order_number.slice(-4)}`, {
           description: `Drinks for Room ${order.room?.room_number || order.table_number || 'WI'} are ready.`,
           duration: 5000,
         });
         new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(() => {});
         notifiedReady.current.add(barKey);
       }
     });
   }, [scopedMyOrders]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTableCountdownNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const { readyCount, pendingHandoffCount, handoffOrders } = useMemo(() => {
    let ready = 0;
    let pendingHandoff = 0;
    const handoffs: HotelOrder[] = [];

    for (const order of scopedMyOrders) {
      if (order.status === 'ready') {
        ready += 1;
      }

      if (order.status === 'awaiting_approval' || order.status === 'pending_handover') {
        pendingHandoff += 1;
        handoffs.push(order);
      }
    }

    return {
      readyCount: ready,
      pendingHandoffCount: pendingHandoff,
      handoffOrders: handoffs,
    };
  }, [scopedMyOrders]);

  const activeOrderCount = scopedMyOrders.length;

  // ─────────────────────────────────────────────────────────────────────────────
  // FIX 2: tableOrderMap only depends on occupancyOrders — stable dep
  // ─────────────────────────────────────────────────────────────────────────────
  const tableOrderMap = useMemo(() => {
    const map = new Map<string, HotelOrder>();

    occupancyOrders.forEach((order) => {
      const keys = [
        order.table_id ? `id:${order.table_id}` : null,
        normalizeTableNumber(order.table_number) ? `num:${normalizeTableNumber(order.table_number)}` : null,
      ].filter(Boolean) as string[];
      if (keys.length === 0) return;

      const orderTime = new Date(order.updated_at || order.created_at).getTime();

      keys.forEach((key) => {
        const existing = map.get(key);
        const existingTime = existing ? new Date(existing.updated_at || existing.created_at).getTime() : 0;

        if (!existing || orderTime >= existingTime) {
          map.set(key, order);
        }
      });
    });

    return map;
  }, [occupancyOrders]);

  

  const tableLookupMap = useMemo(() => {
    const map = new Map<string, HotelTable>();
    tables.forEach((table) => {
      map.set(`id:${table.id}`, table);
      const normalizedNumber = normalizeTableNumber(table.table_number);
      if (normalizedNumber) {
        map.set(`num:${normalizedNumber}`, table);
      }
    });
    return map;
  }, [tables]);

  const resolvedServiceTable = useMemo(() => {
    if (selectedServiceTable) {
      return selectedServiceTable;
    }

    const normalized = normalizeTableNumber(tableNumber);
    if (!normalized) return null;
    return tableLookupMap.get(`num:${normalized}`) || null;
  }, [selectedServiceTable, tableNumber, tableLookupMap]);

  const { data: activeTableSession } = useActiveTableSession(
    resolvedServiceTable?.id || null,
    !!resolvedServiceTable
  );

  const isSeatBasedTableOrder = false;

  // ─────────────────────────────────────────────────────────────────────────────
  // FIX 2 (continued): inline lookup in getLinkedOrderForTable — no callback dep
  // ─────────────────────────────────────────────────────────────────────────────
  const getLinkedOrderForTable = useCallback((table?: Pick<HotelTable, 'id' | 'table_number'> | null) => {
    if (!table) return null;
    return (
      tableOrderMap.get(`id:${table.id}`) ||
      tableOrderMap.get(`num:${normalizeTableNumber(table.table_number)}`) ||
      null
    );
  }, [tableOrderMap]);

  // ─────────────────────────────────────────────────────────────────────────────
  // FIX 2 (continued): tableSelectionCards uses tableOrderMap directly, not the
  // getLinkedOrderForTable callback — prevents a re-sort on every render cycle
  // ─────────────────────────────────────────────────────────────────────────────
  const tableSelectionCards = useMemo(() => {
    return [...tables]
      .map((table) => {
        // Inline lookup — avoids callback reference instability
        const linkedOrder =
          tableOrderMap.get(`id:${table.id}`) ||
          tableOrderMap.get(`num:${normalizeTableNumber(table.table_number)}`) ||
          null;

        const ownedByCurrentWaiter = linkedOrder
          ? canManageHotelTable(activeStaff, linkedOrder)
          : true;
        const effectiveStatus = getEffectiveHotelTableStatus(table.status, linkedOrder);
        const displayWaiter = linkedOrder?.waiter || linkedOrder?.assigned_waiter;
        const waiterName = displayWaiter
          ? `${displayWaiter.first_name} ${displayWaiter.last_name}`.trim()
          : "";

        return { table, linkedOrder, ownedByCurrentWaiter, effectiveStatus, waiterName };
      })
      .sort((a, b) => {
        const aNum = a.table.table_number.replace(/\D/g, "");
        const bNum = b.table.table_number.replace(/\D/g, "");
        if (aNum && bNum) return Number(aNum) - Number(bNum);
        return a.table.table_number.localeCompare(b.table.table_number, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
  }, [tables, tableOrderMap, activeStaff]); // ← stable deps only

  const tableSelectionCounts = useMemo(() => {
    return tableSelectionCards.reduce(
      (acc, item) => {
        if (item.effectiveStatus === 'occupied') {
          acc.occupied += 1;
        }

        if (item.effectiveStatus === 'free' || item.effectiveStatus === 'reserved') {
          acc.available += 1;
        }

        return acc;
      },
      { available: 0, occupied: 0 }
    );
  }, [tableSelectionCards]);
  const activeTableOwnership = useMemo(() => {
    const normalizedTable = tableNumber.trim().toUpperCase();
    if (!normalizedTable) return null;

    return tableOrderMap.get(`num:${normalizedTable}`) || null;
  }, [tableNumber, tableOrderMap]);

  const availableTableCount = tableSelectionCounts.available;
  const occupiedTableCount = tableSelectionCounts.occupied;

  const selectedTableOrder = useMemo(() => {
    return getLinkedOrderForTable(selectedServiceTable);
  }, [getLinkedOrderForTable, selectedServiceTable]);

  // Reset addingToOrder when selectedTableOrder is no longer a table-occupying order
  useEffect(() => {
    if (selectedTableOrder && !isTableOccupyingOrderStatus(selectedTableOrder.status)) {
      setAddingToOrder(null);
    }
  }, [selectedTableOrder?.status, selectedTableOrder]);

const prevStaffIdRef = useRef<string | null>(null);
useEffect(() => {
  const incomingId = activeStaff?.staff_id ?? null;
  const isSameStaff = !!incomingId && incomingId === prevStaffIdRef.current;
  prevStaffIdRef.current = incomingId;

  // Don't reset if: same waiter resuming, or a pending table entry exists
  if (isSameStaff || hasPendingTableEntry) return;

  const isWaiter = isWaiterStaff(activeStaff);
  setPosAccessGranted(!isWaiter);
  // Only clear POS access when switching to a DIFFERENT staff member
  if (!incomingId) {
    clearWaiterPosAccess();
  }
  setSelectedServiceTable(null);
  setTableAccessPin("");
  setShowTablePinDialog(false);
  setTableNumber("");
  setAddingToOrder(null);
  setOrderNotes("");
  setItemNotes({});
  clearCart();
}, [activeStaff?.staff_id, activeShift?.id, hasPendingTableEntry]);



useEffect(() => {
  const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
  return () => clearTimeout(timer);
}, [searchTerm]);

  useEffect(() => {
    setPaymentMethod(normalizePaymentMethod(posSettings?.default_payment_method));
  }, [posSettings?.default_payment_method]);

useEffect(() => {
  // Read from navigation state first, then sessionStorage fallback
  const stateEntry = (location.state as any)?.tableEntry;
  const storageEntry = (() => {
    try {
      const stored = sessionStorage.getItem("waiterTableEntry");
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      const grantedAt = typeof parsed?.grantedAt === "number" ? parsed.grantedAt : 0;
      const isExpired = grantedAt > 0 && Date.now() - grantedAt > waiterPosAccessExpiryMs;
      return parsed?.tableId && !isExpired ? parsed : null;
    } catch {
      return null;
    }
  })();

  // Check for persistent access (e.g. after refresh)
  const posAccess = (() => {
    try {
      const stored = sessionStorage.getItem("hotel.waiterPosAccess");
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      const isExpired =
        parsed?.grantedAt && (Date.now() - parsed.grantedAt > waiterPosAccessExpiryMs);
      return parsed?.tableId && !isExpired ? parsed : null;
    } catch {
      return null;
    }
  })();

  const entry = stateEntry || storageEntry || posAccess;
  if (!entry || tables.length === 0) return;

  const expectedStaffId = entry.staffId || null;
  if (requiresTableAccessGate && expectedStaffId) {
    if (!activeStaff?.staff_id) {
      return;
    }

    if (activeStaff.staff_id !== expectedStaffId) {
      return;
    }
  }

  // Clear sessionStorage once consumed
  if (storageEntry) {
    sessionStorage.removeItem("waiterTableEntry");
  }

  const matchedTable =
    tableLookupMap.get(`id:${entry.tableId}`) ||
    tableLookupMap.get(`num:${normalizeTableNumber(entry.tableNumber)}`);

  if (stateEntry || storageEntry) {
    navigate(location.pathname, { replace: true, state: {} });
  }

  if (!matchedTable) {
    toast.error("Selected table could not be found");
    return;
  }

  const linkedOrder = getLinkedOrderForTable(matchedTable);
  const activeLinkedOrder = linkedOrder && isTableOccupyingOrderStatus(linkedOrder.status) ? linkedOrder : null;
  const effectiveStatus = getEffectiveHotelTableStatus(matchedTable.status, activeLinkedOrder);

  setSelectedServiceTable(matchedTable);
  setTableAccessPin("");
  setShowTablePinDialog(false);


  if (effectiveStatus === "cleaning") {
    setPosAccessGranted(false);
    setAddingToOrder(null);
    setTableNumber("");
    toast.error("This table is still in cleaning mode");
    return;
  }

  if (activeLinkedOrder && !canManageHotelTable(activeStaff, activeLinkedOrder)) {
    setPosAccessGranted(false);
    setAddingToOrder(null);
    setTableNumber("");
    toast.error("This occupied table belongs to another waiter");
    return;
  }

  setTableNumber(matchedTable.table_number);
  setAddingToOrder(
    activeLinkedOrder && canManageHotelOrder(activeStaff, activeLinkedOrder)
      ? activeLinkedOrder
      : null
  );
  setPosAccessGranted(true);

  if (activeStaff?.staff_id) {
    grantWaiterPosAccess({
      staffId: activeStaff.staff_id,
      tableId: matchedTable.id,
      tableNumber: matchedTable.table_number,
    });
  }

  toast.success(
    linkedOrder
      ? `Table ${matchedTable.table_number} reopened for service`
      : `Table ${matchedTable.table_number} ready for a new order`
  );
}, [activeStaff, getLinkedOrderForTable, location.pathname, location.state, navigate, requiresTableAccessGate, tableLookupMap, tables.length]);

  const handleSwitchServiceTable = () => {
    if (cart.length > 0) {
      toast.error("Send or clear the current cart before switching tables");
      return;
    }

    clearWaiterPosAccess();
    setPosAccessGranted(false);
    setSelectedServiceTable(null);
    setTableAccessPin("");
    setShowTablePinDialog(false);
    setTableNumber("");
    setAddingToOrder(null);
  
    setOrderNotes("");
    setItemNotes({});
  };

  const handleSelectServiceTable = useCallback((table: HotelTable) => {
  const linkedOrder = getLinkedOrderForTable(table);
  const effectiveStatus = getEffectiveHotelTableStatus(table.status, linkedOrder);

  if (effectiveStatus === 'cleaning') {
    toast.error("This table is still in cleaning mode");
    return;
  }

  // ❌ Remove: if (linkedOrder && !canManageHotelTable(...)) — this blocked before PIN
  // ✅ Let the PIN dialog open for ALL occupied tables, not just your own

  setSelectedServiceTable(table);
  setTableAccessPin("");
  setShowTablePinDialog(true);
}, [getLinkedOrderForTable]);

  // ─────────────────────────────────────────────────────────────────────────────
  // FIX 1 + FIX 3: Optimistic dialog dismiss + batched state updates
  // ─────────────────────────────────────────────────────────────────────────────
  const handleUnlockServiceTable = async () => {
  if (!selectedServiceTable) {
    toast.error("Choose a table first");
    return;
  }

  if (tableAccessPin.length < 4) {
    toast.error("PIN must be at least 4 digits");
    return;
  }

  setIsUnlockingPOS(true);

  try {
    const linkedOrder = getLinkedOrderForTable(selectedServiceTable);

    const result = await verifyPinOnly(tableAccessPin, {
      expectedStaffId: null,
      waiterOnly: true,
    });

    if (!result.success) {
      toast.error(result.error || "Invalid PIN");
      setTableAccessPin("");
      return;
    }

    // If table is occupied, only the waiter who owns it can unlock it
    if (
      linkedOrder &&
      isTableOccupyingOrderStatus(linkedOrder.status) &&
      !canManageHotelTable(result.staff, linkedOrder)
    ) {
      toast.error("This table is occupied by another waiter");
      setTableAccessPin("");
      return;
    }

    if (activeStaff?.staff_id && result.staff?.staff_id !== activeStaff.staff_id) {
      toast.error("Use your own PIN to unlock this table");
      setTableAccessPin("");
      return;
    }

    if (result.staff?.staff_id) {
      grantWaiterPosAccess({
        staffId: result.staff.staff_id,
        tableId: selectedServiceTable.id,
        tableNumber: selectedServiceTable.table_number,
      });
    }

  
    setTableNumber(selectedServiceTable.table_number);
    setAddingToOrder(
      linkedOrder && canManageHotelOrder(result.staff, linkedOrder)
        ? linkedOrder
        : null
    );
    setTableAccessPin("");
    setShowTablePinDialog(false);
    setPosAccessGranted(true);

    toast.success(
      linkedOrder
        ? `Table ${selectedServiceTable.table_number} reopened for service`
        : `Table ${selectedServiceTable.table_number} ready for a new order`
    );
  } catch (err: any) {
    toast.error(err.message || "Failed to verify PIN");
    setTableAccessPin("");
  } finally {
    setIsUnlockingPOS(false);
  }
};

  // Auto-submit PIN when 6 digits entered in HotelPOS table unlock dialog
  useEffect(() => {
    if (showTablePinDialog && tableAccessPin.length === 6 && !isUnlockingPOS) {
      void handleUnlockServiceTable();
    }
  }, [tableAccessPin, showTablePinDialog, isUnlockingPOS]);

  // Keyboard support for PIN entry in HotelPOS table unlock dialog
  useEffect(() => {
    if (!showTablePinDialog) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        if (tableAccessPin.length < 6) {
          setTableAccessPin(prev => prev + e.key);
        }
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setTableAccessPin(prev => prev.slice(0, -1));
      } else if (e.key === 'Enter' && tableAccessPin.length >= 4 && !isUnlockingPOS) {
        e.preventDefault();
        void handleUnlockServiceTable();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTablePinDialog, tableAccessPin, isUnlockingPOS]);

  const filteredServices = useMemo(() => {
    return services.filter(service => {
      const matchesCategory =
        activeCategory === "all" ||
        normalizeServiceCategoryName(service.category) === normalizeServiceCategoryName(activeCategory);
      const matchesSearch = service.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [services, activeCategory, debouncedSearchTerm]);

  const categoryCounts = useMemo(() => {
    return services.reduce<Record<string, number>>((acc, service) => {
      if (service.category) {
        const normalizedCategory = normalizeServiceCategoryName(service.category);
        acc[normalizedCategory] = (acc[normalizedCategory] || 0) + 1;
      }
      return acc;
    }, {});
  }, [services]);

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
          station: inferServiceCategoryStation(service.category),
          sort_order: Number.MAX_SAFE_INTEGER,
          is_active: true,
          is_system: false,
          created_at: service.created_at,
          updated_at: service.updated_at,
        });
      }
    });

    return Array.from(categoryMap.values()).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  }, [categories, services]);

  const categoryVisuals = useMemo(
    () =>
      new Map(
        visibleCategories.map((category) => [
          normalizeServiceCategoryName(category.name),
          {
            icon: category.icon || inferServiceCategoryIcon(category.name),
            imageUrl: category.image_url || null,
          },
        ]),
      ),
    [visibleCategories]
  );

  const activeCategoryLabel = useMemo(() => {
    if (activeCategory === "all") return "All Items";
    return (
      visibleCategories.find(category => normalizeServiceCategoryName(category.name) === normalizeServiceCategoryName(activeCategory))?.label ||
      formatServiceCategoryLabel(activeCategory)
    );
  }, [activeCategory, visibleCategories]);




  const queueStationKOTPrints = useCallback((params: {
    orderNumber: string;
    type: 'new' | 'updated';
    tableNumber?: string | null;
    roomNumber?: string | null;
    orderNotes?: string;
    items: Array<{
      name: string;
      quantity: number;
      notes?: string | null;
      station?: string | null;
      kotStation?: string | null;
    }>;
  }) => {
    const kitchenItems = params.items
      .filter((item) => (item.kotStation || item.station) === 'kitchen')
      .map((item) => ({ name: item.name, quantity: item.quantity, notes: item.notes || null }));
    const barItems = params.items
      .filter((item) => (item.kotStation || item.station) === 'bar')
      .map((item) => ({ name: item.name, quantity: item.quantity, notes: item.notes || null }));

    const nextPrintJobs: KOTData[] = [];

    if (kitchenItems.length > 0) {
      nextPrintJobs.push({
        orderNumber: params.orderNumber,
        type: params.type,
        station: 'kitchen',
        tableNumber: params.tableNumber,
        roomNumber: params.roomNumber,
        waiterName: activeStaff?.first_name,
        items: kitchenItems,
        orderNotes: params.orderNotes,
        timestamp: new Date(),
      });
    }

    if (barItems.length > 0) {
      nextPrintJobs.push({
        orderNumber: params.orderNumber,
        type: params.type,
        station: 'bar',
        tableNumber: params.tableNumber,
        roomNumber: params.roomNumber,
        waiterName: activeStaff?.first_name,
        items: barItems,
        orderNotes: params.orderNotes,
        timestamp: new Date(),
      });
    }

    if (nextPrintJobs.length > 0) {
      setKotQueue((prevQueue) => {
        const existingKeys = new Set(prevQueue.map(job => `${job.station}|${job.orderNumber}|${job.type}|${job.timestamp.getTime()}|${job.items.map(i=>i.name+i.quantity).join(',')}`));
        const dedupedJobs = nextPrintJobs.filter(job => {
          const key = `${job.station}|${job.orderNumber}|${job.type}|${job.timestamp.getTime()}|${job.items.map(i=>i.name+i.quantity).join(',')}`;
          return !existingKeys.has(key);
        });
        return [...prevQueue, ...dedupedJobs];
      });
    }
  }, [activeStaff?.first_name]);

  // ─── PATCH: Replace your existing handlePlaceOrder function in HotelPOS.tsx ───
// Only this function changes. Everything else stays the same.

const handlePlaceOrder = async () => {
  if (cart.length === 0) { toast.error("Cart is empty"); return; }
  if (!waiterId) { toast.error("Staff not logged in"); return; }
  setIsProcessing(true);
  try {
    let sessionId: string | null = null;
    const orderTimestamp = new Date().toISOString();

    // Pre-resolve session if we are on a table
   if (resolvedServiceTable) {
  let targetSessionId =
    addingToOrder?.session_id || activeTableSession?.id;

  // Ensure every active table order has a session for billing and manager tracking.
  if (!targetSessionId) {
    const session = await openTableSession.mutateAsync({
      tableId: resolvedServiceTable.id,
      guestCount: Math.max(1, activeTableSession?.guest_count || 1),
      openedBy: activeStaff?.staff_id || null,
      openedShiftId: activeShift?.id || null,
      notes: orderNotes || activeTableSession?.notes || null,
    });

    targetSessionId = session.id;
  }

  // Only forward a real UUID to Supabase.
  sessionId = isRealUuid(targetSessionId)
    ? targetSessionId
    : null;
}

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
        notes: itemNotes[item.id] || undefined,
        category: item.service.category,
        station: orderStation === 'other' ? 'kitchen' : orderStation as any,
        kotStation: (orderStation === 'kitchen' || orderStation === 'bar') ? orderStation : 'other',
      };
    });

    if (addingToOrder) {
      if (!canManageHotelOrder(activeStaff, addingToOrder)) {
        toast.error("You can only add items to your own active orders");
        return;
      }

      const preparedItems = buildPreparedItems();
      const optimisticNewItems = preparedItems.map((item) => ({
        id: crypto.randomUUID(),
        order_id: addingToOrder.id,
        service_item_id: item.serviceItemId,
        name: item.name,
        quantity: item.quantity,
        purchase_price: item.purchasePrice || 0,
        unit_price: item.unitPrice,
        total_price: item.unitPrice * item.quantity,
        notes: item.notes || null,
        status: 'pending',
        item_type: item.category,
        station: item.station,
        created_at: orderTimestamp,
      }));
      const additionalSubtotal = optimisticNewItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
      const updatedSubtotal = Number(Number(addingToOrder.subtotal || 0) + additionalSubtotal);
      const updatedTotals = calculateOrderTotals(
        updatedSubtotal,
        Number(addingToOrder.discount_amount || 0),
        taxRate,
        hotelInfo?.tax_inclusive || false
      );

      await addItemsToOrder.mutateAsync({
        orderId: addingToOrder.id,
        sessionId,
        taxRate,
        taxInclusive: hotelInfo?.tax_inclusive || false,
        items: preparedItems,
      });
      upsertActiveOrderCache({
        ...addingToOrder,
        ...updatedTotals,
        session_id: sessionId || addingToOrder.session_id || null,
        status: ['ready', 'served'].includes(addingToOrder.status) ? 'preparing' : addingToOrder.status,
        updated_at: orderTimestamp,
        items: [...(addingToOrder.items || []), ...optimisticNewItems],
      });
      queueStationKOTPrints({
        orderNumber: `#${addingToOrder.order_number.toString().slice(-4)}`,
        type: 'updated',
        tableNumber: addingToOrder.table_number || resolvedServiceTable?.table_number || tableNumber || null,
        roomNumber: addingToOrder.room?.room_number || null,
        orderNotes: orderNotes || undefined,
        items: preparedItems,
      });
      toast.success(`Items appended to order #${addingToOrder.order_number.slice(-4)}`);

      // ─── FIX: clear cart + switch to monitor after adding items ───
      clearCart();
      setItemNotes({});
      setOrderNotes("");
      setAddingToOrder(null);
      // Invalidate monitor so the updated order appears immediately
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      setRightTab("cart");
      setShowMobileCart(false);
      setShowMonitorDialog(true);
      // ──────────────────────────────────────────────────────────────

    } else {
      if (activeTableOwnership && !canManageHotelTable(activeStaff, activeTableOwnership)) {
        toast.error("This table is occupied by another waiter");
        return;
      }

      // NOTE: session is already resolved above (line ~1128) for both the
      // "adding to order" and "new order" paths. Re-opening it here was
      // redundant and caused a second network call that could fail and
      // abort the whole "Send Order" action even after the first call
      // succeeded. Removed — `sessionId` from above is reused as-is.

      const preparedItems = buildPreparedItems();
      const orderPayload = {
        tableId: resolvedServiceTable?.id || null,
        tableNumber: tableNumber || resolvedServiceTable?.table_number || null,
        sessionId,
        customerId: selectedCustomer?.id || null,
        paymentPlan: orderType === 'takeaway' ? takeawayPaymentPlan : orderType === 'delivery' ? deliveryPaymentPlan : null,
        customerName: orderType === 'takeaway' ? (takeawayCustomerName || selectedCustomer?.name || null)
          : orderType === 'delivery' ? (deliveryCustomerName || selectedCustomer?.name || null)
          : selectedCustomer?.name || null,
        customerPhone: orderType === 'takeaway' ? (takeawayCustomerPhone || null) : (orderType === 'delivery' ? deliveryPhone : selectedCustomer?.phone) || null,
        customerEmail: selectedCustomer?.email || null,
        customerAddress: orderType === 'delivery' ? (deliveryAddress || null) : selectedCustomer?.address || null,
        waiterId,
        notes: orderNotes || undefined,
        taxRate,
        taxInclusive: hotelInfo?.tax_inclusive || false,
        discount,
        shiftId: activeShift?.id || null,
        orderType,
        items: preparedItems,
      };

      const orderResponse = await placeOrder.mutateAsync(orderPayload);
      const optimisticOrderItems = orderPayload.items.map((item) => ({
        id: crypto.randomUUID(),
        order_id: orderResponse.id,
        service_item_id: item.serviceItemId,
        name: item.name,
        quantity: item.quantity,
        purchase_price: item.purchasePrice || 0,
        unit_price: item.unitPrice,
        total_price: item.unitPrice * item.quantity,
        notes: item.notes || null,
        status: 'pending' as const,
        item_type: item.category || null,
        station: item.station || 'other',
        created_at: orderTimestamp,
      }));

      upsertActiveOrderCache({
        ...orderResponse,
        customer_id: selectedCustomer?.id || null,
        customer_name: selectedCustomer?.name || null,
        customer_phone: selectedCustomer?.phone || null,
        customer_email: selectedCustomer?.email || null,
        customer_address: selectedCustomer?.address || null,
        session_id: sessionId,
        items: optimisticOrderItems,
        booking: null,
        room: null,
        table: resolvedServiceTable ? {
          id: resolvedServiceTable.id,
          table_number: resolvedServiceTable.table_number,
          name: resolvedServiceTable.name,
          status: resolvedServiceTable.status,
        } : null,
      } as HotelOrder);

      queueStationKOTPrints({
        orderNumber: `#${(orderResponse?.order_number || 'NEW').toString().slice(-4)}`,
        type: 'new',
        tableNumber: orderPayload.tableNumber,
        roomNumber: null,
        orderNotes: orderPayload.notes,
        items: orderPayload.items,
      });

      toast.success("Order sent to kitchen successfully");

      // ─── Customer upsert (fire-and-forget) ───
      if (orderType === 'takeaway' && (takeawayCustomerName || takeawayCustomerPhone)) {
       void findOrCreateCustomer(
          takeawayCustomerName || '',
          takeawayCustomerPhone || undefined
        ).catch(() => {});
      }
      if (orderType === 'delivery' && (deliveryCustomerName || deliveryPhone || deliveryAddress)) {
        void findOrCreateCustomer(
          deliveryCustomerName || '',
          deliveryPhone || undefined,
          { address: deliveryAddress || undefined }
      }

      // ─── Payment handling moved to Billing POS Handle only ───

      // ─── FIX: set addingToOrder so waiter can append items, then clear cart ───
      setAddingToOrder(null);
setTableNumber("");

      // Always clear cart + notes + invalidate monitor
      clearCart();
      setItemNotes({});
      setOrderNotes("");
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
      setRightTab("cart");
      setShowMobileCart(false);
      setShowMonitorDialog(true);
      // ──────────────────────────────────────────────────────────────
    }
 } catch (error) {
    // Error already handled by mutation
  } finally {
    setIsProcessing(false);
  }
};

  const handleBookReservation = async () => {
    if (!waiterId) { toast.error("Staff not logged in"); return; }
    if (!resolvedServiceTable) { toast.error("Choose a table for the reservation"); return; }
    if (!reservationDate || !reservationTime) { toast.error("Set a reservation date and time"); return; }
    if (!reservationCustomerName) { toast.error("Enter the customer's name"); return; }
    if (!reservationAssignedWaiterId) { toast.error("Choose the waiter responsible for this reservation"); return; }

    const assignedWaiter = activeReservationWaiters.find((waiter) => waiter.id === reservationAssignedWaiterId);
    if (!assignedWaiter) { toast.error("The selected waiter is no longer active"); return; }

    setIsProcessing(true);
    try {
      const parsedDeposit = Number.parseFloat(reservationDeposit);
      const depositAmount = Number.isFinite(parsedDeposit) && parsedDeposit > 0
        ? Number(parsedDeposit.toFixed(2))
        : 0;
      const orderPayload = {
        tableId: resolvedServiceTable.id,
        tableNumber: resolvedServiceTable.table_number,
        customerName: reservationCustomerName,
        customerPhone: reservationCustomerPhone || null,
        waiterId: reservationAssignedWaiterId,
        staffId: activeStaff?.staff_id || waiterId,
        assignedWaiterId: reservationAssignedWaiterId || null,
        notes: orderNotes || undefined,
        taxRate,
        taxInclusive: hotelInfo?.tax_inclusive || false,
        discount: 0,
        shiftId: activeShift?.id || null,
        orderType: 'reservation' as const,
        reservationDate,
        reservationTime,
        partySize: Number(partySize) || null,
        depositAmount,
        depositPaidAt: depositAmount > 0 ? new Date().toISOString() : null,
        items: [],
      };

      const orderResponse = await placeOrder.mutateAsync(orderPayload);
      await updateTableStatus.mutateAsync({ id: resolvedServiceTable.id, status: 'reserved' });

      toast.success(`Table ${resolvedServiceTable.table_number} reserved for ${reservationDate} ${reservationTime}`);

      // ─── Deposit handling moved to Billing POS Handle only ───

      setReservationDate("");
      setReservationTime("");
      setPartySize("2");
      setReservationCustomerName("");
      setReservationCustomerPhone("");
      setReservationAssignedWaiterId("");
      setReservationDeposit("");
      setTableNumber("");
      setSelectedServiceTable(null);
      queryClient.invalidateQueries({ queryKey: ['hotel-reservations'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
    } catch (error) {
      // Error already handled by mutation
    } finally {
      setIsProcessing(false);
    }
  };

  const openMonitorDialog = () => {
    setShowMobileCart(false);
    setShowMonitorDialog(true);
  };

  const upsertActiveOrderCache = useCallback((incomingOrder: HotelOrder) => {
    queryClient.setQueriesData({ queryKey: ['hotel-orders'] }, (current: unknown) => {
      if (!Array.isArray(current)) {
        return current;
      }

      let found = false;
      const nextOrders = current.map((order) => {
        if (!order || typeof order !== 'object' || (order as HotelOrder).id !== incomingOrder.id) {
          return order;
        }

        found = true;
        const existingOrder = order as HotelOrder;
        return {
          ...existingOrder,
          ...incomingOrder,
          items: incomingOrder.items || existingOrder.items || [],
        };
      });

      if (!found) {
        nextOrders.unshift(incomingOrder);
      }

      return nextOrders.sort(
        (left, right) =>
          new Date((right as HotelOrder).created_at).getTime() - new Date((left as HotelOrder).created_at).getTime()
      );
    });
  }, [queryClient]);

  const visibleMonitorOrders = useMemo(() => monitorOrders.filter(order => {
    const isOrderDone = ["billed", "paid", "settled", "cancelled"].includes(order.status);
    const sessionAlreadyPaid =
      !!order.session_id &&
      (order.session?.payment_status === 'paid' || order.session?.status === 'closed');
    return !isOrderDone && !sessionAlreadyPaid;
  }), [monitorOrders]);
  const visibleMonitorOrderCount = visibleMonitorOrders.length;

  const resetPaymentState = useCallback(() => {
    setShowPaymentDialog(false);
    setPaidAmount("");
    setSplitPayments([]);
    setIsSplitMode(false);
    setPaymentMethod(normalizePaymentMethod(posSettings?.default_payment_method));
    directPaymentOperationKeyRef.current = null;
  }, [posSettings?.default_payment_method]);

  const handleProcessDirectPayment = async (
    options?: {
      isSplitOverride?: boolean;
      paymentMethodOverride?: PaymentMethodType;
    }
  ) => {
    if (cart.length === 0) return;
    if (activeTableOwnership && !canManageHotelTable(activeStaff, activeTableOwnership)) {
      toast.error("This table is occupied by another waiter");
      return;
    }
    setIsProcessing(true);
    try {
      const shouldUseSplit = options?.isSplitOverride ?? isSplitMode;
      const selectedPaymentMethod = options?.paymentMethodOverride ?? paymentMethod;
      if (!directPaymentOperationKeyRef.current) {
        directPaymentOperationKeyRef.current = crypto.randomUUID();
      }
      const payments: HotelPOSPayment[] = shouldUseSplit
        ? splitPayments 
        : [{ method: selectedPaymentMethod, amount: total }];
      
      const invoice = await processDirectPayment(payments, {
        tableId: selectedServiceTable?.id || null,
        tableNumber: tableNumber || selectedServiceTable?.table_number || null,
        customer: selectedCustomer,
        operationKey: directPaymentOperationKeyRef.current,
      });
      if (invoice) {
        const nextReceiptData = {
          invoiceNumber: invoice.invoice_number,
          items: [...cart],
          subtotal,
          discount,
          discountAmount,
          taxRate,
          taxAmount,
          total,
          paymentMethod: shouldUseSplit ? 'split' : selectedPaymentMethod,
          splitPayments: shouldUseSplit ? splitPayments : undefined,
          paidAmount: Number(paidAmount) || total,
          changeAmount: (Number(paidAmount) || total) - total,
          hotelInfo,
          customer: selectedCustomer ? {
            ...selectedCustomer,
            tin_number: selectedCustomer.tin_number || null
          } : null,
          saleDate: new Date()
        };
        setReceiptData(nextReceiptData);
        setLastReceiptData(nextReceiptData);

        clearCart();
      
        setOrderNotes("");
        setItemNotes({});
        setAddingToOrder(null);

        if (requiresTableAccessGate) {
          setAddingToOrder(null);
        } else {
          setTableNumber("");
        }

        resetPaymentState();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickDirectPay = async () => {
    await handleProcessDirectPayment({
      isSplitOverride: false,
      paymentMethodOverride: normalizePaymentMethod(paymentMethod),
    });
  };

  const addSplitPayment = () => {
    const currentSplitTotal = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = total - currentSplitTotal;
    if (remaining <= 0) return;
    setSplitPayments([...splitPayments, { method: 'cash', amount: remaining }]);
  };

  const removeSplitPayment = (index: number) => {
    setSplitPayments(splitPayments.filter((_, i) => i !== index));
  };

  const updateSplitPayment = (index: number, field: keyof SplitPayment, value: any) => {
    const newSplits = [...splitPayments];
    newSplits[index] = { ...newSplits[index], [field]: value };
    setSplitPayments(newSplits);
  };



  const handleCollectedOrderReceipt = useCallback((order: HotelOrder, collectedPaymentMethod: string) => {
    const hydratedOrder = 
      [...scopedMyOrders, ...monitorOrders, ...occupancyOrders].find(
        o => o.id === order.id && (o.items?.length ?? 0) > 0
      ) || order;
    const receiptItems = buildReceiptItemsFromOrder(hydratedOrder);

    const nextReceiptData = {
      invoiceNumber: order.order_number,
      items: receiptItems,
      subtotal: Number(order.subtotal || 0),
      discount: 0,
      discountAmount: Number(order.discount_amount || 0),
      taxRate: inferStoredOrderTaxRate(order),
      taxAmount: Number(order.tax_amount || 0),
      total: Number(order.total_amount || 0),
      depositCreditAmount: getReservationDepositCredit(order),
      paymentMethod: collectedPaymentMethod,
      paidAmount: getOrderBalanceDue(order),
      changeAmount: 0,
      hotelInfo,
      customer: {
  name: order.customer_name || null,
  phone: order.customer_phone || null,
  email: order.customer_email || null,
  address: order.customer_address || null,
  tin_number: order.customer_tin || null,
},
      chargeLabel: "PAYMENT COLLECTED",
      saleDate: new Date(),
    };

   setReceiptData(nextReceiptData);
    setLastReceiptData(nextReceiptData);
  }, [hotelInfo]);

  if (isWaiterStaff(activeStaff)) {
    return <Navigate to="/restaurant/waiter-pos" replace />;
  }

return (
    <Layout disableScroll={true}>
      <div className="fixed inset-0 z-0 bg-slate-200" />
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden font-sans text-slate-900 selection:bg-primary/10 -mt-[var(--layout-padding,0px)]">
        <header className="relative z-30 flex items-center justify-between border-b border-slate-300 bg-slate-50 px-4 py-3 shrink-0">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                <span className="text-xl font-black uppercase text-primary">
                  {(posSettings?.pos_name || 'T').charAt(0)}
                </span>
              </div>
            </div>
            
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
              <h1 className="flex items-end gap-2">
  <span
    className="
      text-3xl
      font-black
      uppercase
      tracking-tight
      bg-gradient-to-r
      from-cyan-500
      via-blue-600
      to-purple-600
      bg-clip-text
      text-transparent
      drop-shadow-lg
    "
  >
    TRANSFORMER
  </span>

  <span
    className="
      rounded-md
      bg-gradient-to-r
      from-blue-600
      to-purple-600
      px-2
      py-1
      text-[10px]
      font-bold
      tracking-[0.2em]
      text-white
      shadow-lg
    "
  >
    POS
  </span>
</h1>
               </div>
              <div className="mt-1.5 hidden items-center gap-3 sm:flex">
                {isShiftActive ? (
                  <button 
                    onClick={() => setShowCloseShiftDialog(true)}
                    className="flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-1 transition-colors hover:bg-emerald-100"
                  >
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Shift Open</span>
                  </button>
                ) : (
                  <button 
                    onClick={() => setShowOpenShiftDialog(true)}
                    className="flex items-center gap-2 rounded-sm border border-slate-300 bg-white px-2 py-1 transition-colors hover:bg-slate-50"
                  >
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shift Closed</span>
                  </button>
                )}
                <div className="h-4 w-px bg-slate-300" />
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{activeStaff?.first_name || "ADMIN"}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
           <div className="hidden h-10 items-center gap-1 rounded-md border border-slate-300 bg-white p-1 sm:flex">
  <Button
    type="button"
    size="sm"
    variant="ghost"
    onClick={() => { setPendingOrderType('takeaway'); setShowOrderTypeDialog(true); }}
    className={cn(
      "h-8 rounded-sm px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
      orderType === 'takeaway' ? "bg-slate-800 text-white hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"
    )}
  >
    Takeaway
  </Button>
  <Button
    type="button"
    size="sm"
    variant="ghost"
    onClick={() => { setPendingOrderType('delivery'); setShowOrderTypeDialog(true); }}
    className={cn(
      "h-8 rounded-sm px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
      orderType === 'delivery' ? "bg-slate-800 text-white hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"
    )}
  >
    Delivery
  </Button>
  <Button
    type="button"
    size="sm"
    variant="ghost"
    onClick={() => { setPendingOrderType('reservation'); setShowOrderTypeDialog(true); }}
    className={cn(
      "h-8 rounded-sm px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
      orderType === 'reservation' ? "bg-slate-800 text-white hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"
    )}
  >
    Reservation
  </Button>
</div>

            <Separator orientation="vertical" className="mx-1 hidden h-8 bg-slate-300 lg:block" />

            <div className="hidden px-2 lg:flex lg:flex-col lg:items-end">
              <span className="mb-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500">Total</span>
              <span className="text-xl font-semibold leading-none tracking-tight text-slate-950 tabular-nums">
                {formatCurrency(total)}
              </span>
            </div>

            <Button 
              disabled={cart.length === 0 || isProcessing}
              onClick={() => safeHandleAction(handlePlaceOrder)}
              className="hidden h-10 items-center gap-2 rounded-md bg-slate-800 px-4 text-[12px] font-semibold text-white shadow-none transition-all duration-200 active:scale-95 hover:bg-slate-700 sm:flex"
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 transition-transform" />}
              <span>{addingToOrder ? `Update Order` : "Send Order"}</span>
            </Button>

            <Button 
              variant="ghost" 
              size="icon" 
              onClick={logoutStaff}
              className="h-10 w-10 rounded-md text-slate-400 transition-all duration-500 hover:bg-rose-50 hover:text-rose-600"
            >
              <LogOut className="h-4.5 w-4.5" />
            </Button>
          </div>
        </header>

        {/* --- MAIN INTERFACE --- */}
        <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {requiresTableAccessGate && !canAccessUnlockedPOS && (
            <div className="absolute inset-0 z-[40] bg-slate-900/80 p-4 backdrop-blur-md">
              <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-4">
                <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-2xl">
                  <CardContent className="flex min-h-0 flex-1 flex-col pt-6">
                    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="text-2xl font-bold text-slate-900">Choose Service Table</h2>
                        <p className="text-sm text-slate-500">
                          Start from an available table or reopen your occupied table before entering the main POS.
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            resetBackendReachable();
                            window.location.reload();
                          }}
                          className="h-10 gap-2 border-slate-300 bg-white"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Refresh Connection
                        </Button>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                          <p className="text-xl font-bold text-emerald-700">{availableTableCount}</p>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-600">Available</p>
                        </div>
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-center">
                          <p className="text-xl font-bold text-rose-700">{occupiedTableCount}</p>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-600">Occupied</p>
                        </div>
                      </div>
                    </div>

                    <ScrollArea className="min-h-0 flex-1 pr-2">
                      {showTablePinDialog && selectedServiceTable ? (
                        <div className="mx-auto max-w-md animate-in fade-in zoom-in duration-300">
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleUnlockServiceTable();
                            }}
                            className="space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl"
                          >
                            <div className="text-center">
                              <h3 className="text-2xl font-bold text-slate-900">Unlock Table {selectedServiceTable.table_number}</h3>
                              <p className="mt-1 text-sm text-slate-500">Enter your waiter PIN to access this table</p>
                            </div>

                            <div className="space-y-4">
                              <div className="flex justify-center">
                                <TableStatusScene
                                  capacity={selectedServiceTable.capacity}
                                  status={(selectedTableOrder ? "occupied" : selectedServiceTable.status) as HotelTableStatus}
                                  hasWaiter={!!selectedTableOrder}
                                  className="max-w-[200px]"
                                  svgClassName="h-[120px]"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor="waiter-pos-pin-inline" className="text-xs font-bold uppercase tracking-widest text-slate-400">
                                  Waiter PIN
                                </Label>
                                <Input
  id="waiter-pos-pin-inline"
  type="password"
  autoComplete="new-password"
  inputMode="numeric"
  autoFocus
  maxLength={6}
  value={tableAccessPin}
  onChange={(e) => {
    setTableAccessPin(e.target.value.replace(/\D/g, ""));
  }}
  placeholder="••••"
  className="h-14 text-center text-3xl font-bold tracking-[0.5em]"
/>
                              </div>
                            </div>

                            <div className="flex gap-3">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  setShowTablePinDialog(false);
                                  setSelectedServiceTable(null);
                                  setTableAccessPin("");
                                }}
                                className="h-12 flex-1 rounded-xl"
                              >
                                Back to Tables
                              </Button>
                              <Button
                                type="submit"
                                disabled={isUnlockingPOS || tableAccessPin.length < 4}
                                className="h-12 flex-1 gap-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                              >
                                {isUnlockingPOS ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                                Unlock POS
                              </Button>
                            </div>
                          </form>
                        </div>
                      ) : tableSelectionCards.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2 pb-4 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                          {tableSelectionCards.map(({ table, linkedOrder, ownedByCurrentWaiter, effectiveStatus, waiterName }) => {
                            const isSelected = normalizeTableNumber(selectedServiceTable?.table_number) === normalizeTableNumber(table.table_number);
                            const canUseTable = effectiveStatus !== 'cleaning';
                            const visualStatus = effectiveStatus as HotelTableStatus;
                            const cleaningCountdown = visualStatus === 'cleaning' ? getCleaningCountdown(table, tableCountdownNow) : null;
                            const isCleaningAlmostDone =
                              visualStatus === 'cleaning' && getCleaningRemainingMs(table, tableCountdownNow) <= 10_000;

                            return (
                              <button
                                key={table.id}
                                type="button"
                                onClick={() => {
                                  handleSelectServiceTable(table);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleSelectServiceTable(table);
                                  }
                                }}
                                disabled={!canUseTable}
                                className={cn(
                                  "cursor-pointer touch-manipulation select-none overflow-hidden rounded-xl border text-left shadow-[0_18px_60px_rgba(15,23,42,0.08)] transition-all duration-75 active:scale-[0.985] active:shadow-[0_10px_28px_rgba(15,23,42,0.16)]",
                                  tableCardStyles[visualStatus],
                                  isSelected && "border-primary ring-2 ring-primary/20 shadow-[0_20px_70px_rgba(59,130,246,0.16)]",
                                  canUseTable && !isSelected && "hover:-translate-y-0.5 hover:border-primary/40",
                                  !canUseTable && "cursor-not-allowed opacity-60 grayscale-[0.1]"
                                )}
                              >
                                <div className="relative p-2">
                                  <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white/70 to-transparent" />
                                  <div className="relative flex items-start justify-between gap-2">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="text-base font-bold tracking-tight text-slate-900">{table.table_number}</p>
                                        <Badge className={cn("px-1.5 py-0 text-[10px] capitalize", tableStatusStyles[visualStatus])}>
                                          {visualStatus}
                                        </Badge>
                                      </div>
                                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                                        {table.name || table.area || "Dining Table"}
                                      </p>
                                      {waiterName && (
                                        <span
                                          className={cn(
                                            "mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                            linkedOrder
                                              ? ownedByCurrentWaiter
                                                ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
                                                : "border-amber-200 bg-amber-50/90 text-amber-700"
                                              : "border-slate-200 bg-white/85 text-slate-700"
                                          )}
                                        >
                                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/5 text-[9px] font-bold">
                                            {getInitials(waiterName)}
                                          </span>
                                          <span className="truncate">{ownedByCurrentWaiter ? "You" : waiterName}</span>
                                          {linkedOrder && !ownedByCurrentWaiter && <Lock className="h-3 w-3 shrink-0" />}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                    {isSelected && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                                        <CheckCircle2 className="h-3 w-3" />
                                        Selected
                                      </span>
                                    )}
                                    {cleaningCountdown && (
                                      <span
                                        className={cn(
                                          "inline-flex items-center rounded-full border bg-white/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                                          isCleaningAlmostDone
                                            ? "border-emerald-300 text-emerald-700"
                                            : "border-slate-300 text-slate-600"
                                        )}
                                      >
                                        Free in {cleaningCountdown}
                                      </span>
                                    )}
                                    </div>
                                  </div>

                                  <div className="relative mt-1">
                                   <TableStatusScene
                                   capacity={table.capacity}
                                    status={visualStatus}
                                     hasWaiter={!!linkedOrder}
                                     className="max-w-[100px]"
                                      svgClassName="h-[64px]"
                                     />
                                     </div>

                                  <div className="mt-1 rounded-lg border border-white/70 bg-white/70 p-2 backdrop-blur">
                                    <div className="flex items-center justify-between gap-1 text-[10px] text-slate-500">
                                      <span className="truncate">{table.area || "Dining"}</span>
                                      <span className="shrink-0">{table.capacity} seats</span>
                                    </div>
                                    <p className="mt-0.5 truncate text-[10px] font-medium leading-4 text-slate-600">
                                      {visualStatus === 'cleaning'
                                        ? `Cleaning — ${cleaningCountdown}`
                                        : linkedOrder
                                        ? ownedByCurrentWaiter
                                          ? `You — ${waiterName || 'Active'}`
                                          : waiterName
                                            ? `${waiterName}`
                                            : "Another waiter"
                                        : visualStatus === "reserved"
                                          ? "Reserved"
                                          : "Available"}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                          <div className="mb-4 rounded-full bg-slate-100 p-6">
                            <Layers className="h-12 w-12 text-slate-300" />
                          </div>
                          <h3 className="text-xl font-bold text-slate-900">No Tables Found</h3>
                          <p className="mt-2 max-w-xs text-slate-500">
                            We couldn't load the service tables. This might be due to a connection issue with the ProLiant server.
                          </p>
                          <Button
                            onClick={() => {
                              resetBackendReachable();
                              window.location.reload();
                            }}
                            className="mt-6 gap-2"
                          >
                            <RefreshCw className="h-4 w-4" />
                            Retry Loading Tables
                          </Button>
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {!isShiftActive && !isManagerLikeStaff(activeStaff) && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px]">
              <Card className="w-full max-w-md border-slate-200 shadow-2xl">
                <CardContent className="pt-6 text-center">
                  <div className="mb-4 flex justify-center">
                    <div className="rounded-full bg-amber-100 p-4">
                      <Clock className="h-8 w-8 text-amber-600" />
                    </div>
                  </div>
                  <h2 className="mb-2 text-xl font-bold text-slate-900">Shift Required</h2>
                  <p className="mb-6 text-sm text-slate-500">
                    You must open a new shift before you can start taking orders or processing payments.
                  </p>
                  <div className="flex flex-col gap-3">
                    <Button 
                      size="lg"
                      onClick={() => setShowOpenShiftDialog(true)}
                      className="w-full bg-primary text-white hover:bg-primary/90"
                    >
                      <Plus className="mr-2 h-4 w-4" /> Open New Shift
                    </Button>
                    <Button 
                      variant="ghost"
                      onClick={logoutStaff}
                      className="w-full text-slate-500"
                    >
                      <LogOut className="mr-2 h-4 w-4" /> Switch Staff
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-slate-200/70 bg-gradient-to-b from-rose-50/25 via-white to-violet-50/25 px-2 py-3 text-slate-700 no-scrollbar md:flex">
            <div className="border-b border-slate-200/70 px-2 pb-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-400">Categories</p>
              <p className="mt-1 text-xs text-slate-500">Browse by service group</p>
            </div>
            <button 
              onClick={() => setActiveCategory("all")}
              className={cn(
                "group relative mt-3 flex w-full items-center justify-start gap-3 rounded-md border px-3 py-2.5 text-left transition-all duration-150",
                activeCategory === "all" 
                  ? "border-rose-200/70 bg-white text-rose-600 shadow-[0_6px_18px_rgba(244,114,182,0.10)]" 
                  : "border-transparent bg-white/40 text-slate-700 hover:border-rose-100/80 hover:bg-rose-50/60"
              )}
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="flex-1 text-sm font-medium">All Items</span>
              <span className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                activeCategory === "all" ? "bg-rose-50 text-rose-500" : "bg-rose-50/70 text-slate-500"
              )}>
                {services.length}
              </span>
            </button>

            {visibleCategories.map(cat => {
              const normalizedCategory = normalizeServiceCategoryName(cat.name);
              const isActive = activeCategory === cat.name;
              return (
                <button 
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.name)}
                  className={cn(
                    "group relative mt-1 flex w-full items-center justify-start gap-3 rounded-md border px-3 py-2.5 text-left transition-all duration-150",
                    isActive 
                      ? "border-violet-200/70 bg-white text-violet-600 shadow-[0_6px_18px_rgba(167,139,250,0.12)]" 
                      : "border-transparent bg-white/40 text-slate-700 hover:border-violet-100/80 hover:bg-violet-50/55"
                  )}
                >
                  <ServiceCategoryVisual
                    imageUrl={cat.image_url}
                    iconName={cat.icon || inferServiceCategoryIcon(cat.name)}
                    label={cat.label}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1"
                    iconClassName="h-4 w-4"
                  />
                  <span className="flex-1 truncate text-sm font-medium">{cat.label}</span>
                  <span className={cn(
                    "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    isActive ? "bg-violet-50 text-violet-500" : "bg-violet-50/70 text-slate-500"
                  )}>
                    {categoryCounts[normalizedCategory] || 0}
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-rose-100 bg-gradient-to-r from-rose-50 via-white to-violet-50 px-4 py-3 no-scrollbar md:hidden">
            <Button
              size="sm"
              variant={activeCategory === "all" ? "default" : "outline"}
              onClick={() => setActiveCategory("all")}
              className={cn(
                "h-9 shrink-0 gap-2 rounded-sm border px-3.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                activeCategory === "all"
                  ? "border-rose-200 bg-rose-500 text-white shadow-sm"
                  : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
              )}
            >
              <LayoutGrid className="h-4 w-4" />
              <span>All</span>
              <span
                className={cn(
                  "rounded-sm px-1.5 py-0.5 text-[9px] font-semibold tabular-nums",
                  activeCategory === "all" ? "bg-white/20 text-white" : "bg-rose-50 text-rose-600"
                )}
              >
                {services.length}
              </span>
            </Button>
            {visibleCategories.map(cat => {
              const normalizedCategory = normalizeServiceCategoryName(cat.name);
              const isActive = activeCategory === cat.name;
              return (
                <Button
                  key={cat.id}
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  onClick={() => setActiveCategory(cat.name)}
                  className={cn(
                    "h-9 shrink-0 gap-2 rounded-sm px-3.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    isActive ? "bg-violet-400 text-white shadow-sm" : "border-violet-100 bg-white text-slate-700"
                  )}
                >
                  <ServiceCategoryVisual
                    imageUrl={cat.image_url}
                    iconName={cat.icon || inferServiceCategoryIcon(cat.name)}
                    label={cat.label}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md ring-1 overflow-hidden",
                      isActive && "bg-white/15 text-white ring-white/20"
                    )}
                    iconClassName="h-3.5 w-3.5"
                    imageClassName="h-full w-full object-cover"
                  />
                  {cat.label}
                </Button>
              );
            })}
          </div>

          <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-slate-100">
            <div className="relative z-10 flex items-center gap-3 border-b border-slate-300 bg-slate-50 px-4 py-3">
              <div className="relative flex-1">
                <div className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-3">
                  <Search className="h-4 w-4 text-slate-400" />
                </div>
                <Input 
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search items... (F2)" 
                  className="h-10 rounded-sm border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-none transition-all placeholder:text-slate-400 focus:border-primary/30 focus:bg-white focus:ring-0"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex h-10 items-center gap-3 rounded-sm border border-slate-300 bg-white px-3">
                  <div className="flex flex-col items-end">
                    <span className="mb-0.5 text-[9px] font-medium uppercase leading-none tracking-[0.14em] text-slate-500">
                      {activeCategoryLabel}
                    </span>
                    <span className="text-base font-semibold leading-none tabular-nums text-slate-900">{filteredServices.length}</span>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <Layers className="h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 relative z-10">
              <ScrollArea className="h-full px-3 pb-4 pt-3 md:px-4">
                {servicesLoading ? (
                  <div className="flex flex-col items-center justify-center h-[300px] gap-4">
                    <div className="h-12 w-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                    <span className="text-sm font-medium text-slate-500">Loading items...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 pb-10 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {filteredServices.map(service => {
                      const normalizedCategory = normalizeServiceCategoryName(service.category);
                      const categoryVisual =
                        categoryVisuals.get(normalizedCategory) || {
                          icon: inferServiceCategoryIcon(service.category),
                          imageUrl: null,
                        };

                      return (
                        <ServiceCard 
                          key={service.id} 
                          service={service} 
                          cartItem={(() => {
                            const matchingItems = cart.filter((item) => item.service.id === service.id);
                            if (matchingItems.length === 0) return undefined;
                            return {
                              ...matchingItems[0],
                              quantity: matchingItems.reduce((sum, item) => sum + item.quantity, 0),
                            };
                          })()}
                          addToCart={(s) => safeHandleAction(() => addToCart(s, 1))}
                          formatCurrency={formatCurrency}
                          categoryIconName={categoryVisual.icon}
                          categoryImageUrl={categoryVisual.imageUrl}
                        />
                      );
                    })}
                  </div>
                )}
                {filteredServices.length === 0 && !servicesLoading && (
                  <div className="flex flex-col items-center justify-center h-[420px] text-slate-400">
                    <Monitor className="h-16 w-16 opacity-20 mb-4" />
                    <p className="text-base font-medium text-center">No items found</p>
                  </div>
                )}
              </ScrollArea>
            </div>
          </section>

          <aside className="relative z-20 hidden w-[360px] shrink-0 flex-col border-l border-slate-200/70 bg-gradient-to-b from-white via-slate-50/70 to-violet-50/30 lg:flex">
            <div className="shrink-0 border-b border-slate-300 bg-white p-3">
              <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as any)} className="w-full">
                <TabsList className="grid h-10 w-full grid-cols-4 rounded-sm border border-rose-100 bg-gradient-to-r from-rose-50 to-violet-50 p-1">
                  <TabsTrigger 
                    value="cart" 
                    className="rounded-sm text-[10px] font-semibold uppercase tracking-[0.12em] transition-all data-[state=active]:bg-rose-400 data-[state=active]:text-white"
                  >
                    <ShoppingCart className="h-3.5 w-3.5 mr-2" /> Cart ({cart.length})
                  </TabsTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={openMonitorDialog}
                    className="relative h-8 rounded-sm px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700 hover:bg-violet-100 hover:text-violet-700"
                  >
                    <ClipboardList className="h-3.5 w-3.5 mr-2" /> Monitor
                    {visibleMonitorOrderCount > 0 && (
  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-400 px-1 text-[9px] font-semibold text-white">
    {visibleMonitorOrderCount}
  </span>
)}
                  
                  </Button>

                  <TabsTrigger 
                    value="handoffs" 
                    className="relative overflow-hidden rounded-sm text-[10px] font-semibold uppercase tracking-[0.12em] transition-all data-[state=active]:bg-violet-400 data-[state=active]:text-white"
                  >
                    <Banknote className="h-3.5 w-3.5 mr-2" /> Handoff
                    {pendingHandoffCount > 0 && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 bg-rose-500 rounded-full animate-pulse" />
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {rightTab === "cart" ? (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="min-h-0 flex-1">
                    <ScrollArea className="h-full px-3 pt-3">
                      <div className="pb-3">
                        {cart.length === 0 ? (
                          <div className="flex h-[300px] flex-col items-center justify-center text-slate-400">
                            <ShoppingBag className="mb-4 h-16 w-16 opacity-20" />
                            <p className="text-sm font-medium">Cart is empty</p>
                          </div>
                        ) : (
                          <CartItems 
                            cart={cart}
                            updateQuantity={updateQuantity}
                            removeFromCart={removeFromCart}
                            itemNotes={itemNotes}
                            setItemNotes={setItemNotes}
                            orderNotes={orderNotes}
                            setOrderNotes={setOrderNotes}
                            formatCurrency={formatCurrency}
                          />
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                 <div className="hidden space-y-3 border-t border-slate-200/70 bg-white/95 p-3">
                    <div className="space-y-2 rounded-sm border border-slate-200/70 bg-gradient-to-br from-white via-rose-50/25 to-violet-50/25 p-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Subtotal</span>
                        <span className="tabular-nums text-slate-700">{formatCurrency(subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Discount</span>
                        <span className="tabular-nums text-emerald-700">{formatCurrency(discountAmount)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Tax ({taxRate}%)</span>
                        <span className="tabular-nums text-slate-700">{formatCurrency(taxAmount)}</span>
                      </div>
                      <div className="border-t border-slate-200/70 pt-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-500">
                            Total
                          </p>
                          <span className="text-lg font-semibold tabular-nums text-slate-900">{formatCurrency(total)}</span>
                        </div>
                      <p className="mt-1 text-[11px] text-slate-500">
  {selectedCustomer?.name
    ? `${selectedCustomer.name}${tableNumber ? ` • Table ${tableNumber}` : ""}`
    : tableNumber
      ? `Table ${tableNumber}`
      : "Walk-in order"}
</p>
                      </div>
                    </div>

                    

                    <div className="rounded-sm border border-violet-100 bg-violet-50/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700">
                      Send order first. Cashier confirms payment in Billing POS Handle.
                    </div>
                    <Button 
                      disabled={cart.length === 0 || isProcessing}
                      onClick={() => safeHandleAction(handlePlaceOrder)}
                      className="h-11 w-full gap-2 rounded-sm bg-violet-400 text-[12px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm shadow-violet-100 hover:bg-violet-500"
                    >
                      {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {addingToOrder ? "Update Order" : "Send Order"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <ActiveOrders 
                    myOrders={scopedMyOrders}
                    readyCount={0}
                    selectedOrderIds={[]}
                    toggleOrderSelection={() => {}}
                    setShowBillDialog={() => {}}
                    formatCurrency={formatCurrency}
                    updateOrderStatus={updateOrderStatus}
                    activeShift={activeShift}
                    activeStaff={activeStaff}
                    startAddingToOrder={() => {}}
                    addingToOrder={null}
                    onCollectPaymentReceipt={handleCollectedOrderReceipt}
                    setCancellingOrder={() => {}} 
                  />
                </div>
              )}
            </div>
          </aside>
        </main>

        {/* --- MOBILE CART TRIGGER & DRAWER --- */}
        <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 lg:hidden">
          <Button
            size="lg"
            className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-xl shadow-primary/30"
            onClick={() => setShowMobileCart(true)}
          >
            <ShoppingCart className="h-6 w-6" />
            {cart.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-rose-500 text-[10px] font-black text-white shadow-lg">
                {cart.length}
              </span>
            )}
          </Button>
          
          <Button
            size="lg"
            className="relative flex h-12 w-12 items-center justify-center rounded-full bg-violet-500 text-white shadow-xl shadow-violet-200"
            onClick={openMonitorDialog}
          >
            <ClipboardList className="h-5 w-5" />
            {visibleMonitorOrderCount > 0 && (
  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-400 px-1 text-[9px] font-semibold text-white">
    {visibleMonitorOrderCount}
  </span>
)}
          </Button>
        </div>

        <Sheet open={showMobileCart} onOpenChange={setShowMobileCart}>
          <SheetContent side="right" className="flex w-full flex-col bg-white p-0 font-sans sm:max-w-lg">
            <SheetHeader className="shrink-0 border-b border-slate-300 bg-white p-4">
              <div className="flex items-center justify-between">
                <SheetTitle className="text-lg font-bold uppercase tracking-tight text-slate-900">Order Panel</SheetTitle>
              </div>
              <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as any)} className="mt-3 w-full">
                <TabsList className="grid h-10 w-full grid-cols-3 rounded-sm border border-rose-100 bg-gradient-to-r from-rose-50 to-violet-50 p-1">
                  <TabsTrigger value="cart" className="rounded-sm text-[10px] font-semibold uppercase tracking-[0.12em] data-[state=active]:bg-rose-400 data-[state=active]:text-white">
                    <ShoppingCart className="h-4 w-4 mr-2" /> Cart ({cart.length})
                  </TabsTrigger>
                  <Button type="button" variant="ghost" onClick={openMonitorDialog} className="relative h-8 rounded-sm px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700 hover:bg-violet-100 hover:text-violet-700">
                    <ClipboardList className="h-4 w-4 mr-2" /> Monitor
                    {visibleMonitorOrderCount > 0 && (
  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-400 px-1 text-[9px] font-semibold text-white">
    {visibleMonitorOrderCount}
  </span>
)}
                  </Button>
                  <TabsTrigger value="handoffs" className="relative overflow-hidden rounded-sm text-[10px] font-semibold uppercase tracking-[0.12em] data-[state=active]:bg-violet-400 data-[state=active]:text-white">
                    <Banknote className="h-4 w-4 mr-2" /> Handoff
                    {pendingHandoffCount > 0 && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 bg-rose-500 rounded-full animate-pulse" />
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </SheetHeader>

            <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
              {rightTab === "cart" ? (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
                  <div className="flex-1 min-h-0">
                    <ScrollArea className="h-full px-3 pt-3">
                      {cart.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center py-20 text-slate-300">
                          <ShoppingBag className="mb-4 h-16 w-16 opacity-20" />
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">Cart Empty</p>
                        </div>
                      ) : (
                        <CartItems 
                          cart={cart}
                          updateQuantity={updateQuantity}
                          removeFromCart={removeFromCart}
                          itemNotes={itemNotes}
                          setItemNotes={setItemNotes}
                          orderNotes={orderNotes}
                          setOrderNotes={setOrderNotes}
                          formatCurrency={formatCurrency}
                        />
                      )}
                    </ScrollArea>
                  </div>
                  <div className="border-t border-slate-200/70 bg-white p-3">
                    <div className="mb-3 space-y-2 rounded-sm border border-slate-200/70 bg-gradient-to-br from-white via-rose-50/55 to-violet-50/55 p-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Subtotal</span>
                        <span className="tabular-nums text-slate-700">{formatCurrency(subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Discount</span>
                        <span className="tabular-nums text-emerald-700">{formatCurrency(discountAmount)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Tax ({taxRate}%)</span>
                        <span className="tabular-nums text-slate-700">{formatCurrency(taxAmount)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200/70 pt-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-500">Total</span>
                        <span className="text-lg font-semibold tabular-nums text-slate-900">{formatCurrency(total)}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="rounded-sm border border-violet-100 bg-violet-50/40 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700">
                        Send order first. Cashier confirms payment in Billing POS Handle.
                      </div>
                      <Button 
                        disabled={cart.length === 0 || isProcessing}
                        onClick={handlePlaceOrder}
                        className="h-11 w-full gap-2 rounded-sm bg-violet-400 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm shadow-violet-100 hover:bg-violet-500"
                      >
                        {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {addingToOrder ? 'Update Order' : 'Send Order'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
                  <ActiveOrders 
                    myOrders={scopedMyOrders}
                    readyCount={0}
                    selectedOrderIds={[]}
                    toggleOrderSelection={() => {}}
                    setShowBillDialog={() => {}}
                    formatCurrency={formatCurrency}
                    updateOrderStatus={updateOrderStatus}
                    activeShift={activeShift}
                    activeStaff={activeStaff}
                    startAddingToOrder={() => {}}
                    addingToOrder={null}
                    onCollectPaymentReceipt={handleCollectedOrderReceipt}
                    setCancellingOrder={() => {}} 
                  />
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* --- DIALOGS & OVERLAYS --- */}

        <Dialog open={showMonitorDialog} onOpenChange={setShowMonitorDialog}>
          <DialogContent className="flex h-[86vh] w-[94vw] max-w-6xl flex-col overflow-hidden rounded-md border border-slate-200/80 bg-white p-0 shadow-2xl" aria-describedby={undefined}>
            <div className="flex items-center justify-between border-b border-slate-200/70 bg-gradient-to-r from-rose-50/55 via-white to-violet-50/50 px-5 py-4">
              <div className="flex flex-col">
                <DialogTitle className="text-lg font-bold uppercase tracking-tight text-slate-900">Active Orders Monitor</DialogTitle>
                <DialogDescription className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {visibleMonitorOrderCount > 0 ? `${visibleMonitorOrderCount} active order${visibleMonitorOrderCount === 1 ? "" : "s"} to review and manage` : "No active hotel POS orders right now"}
                </DialogDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowMonitorDialog(false)} className="h-9 w-9 rounded-sm text-slate-500 hover:bg-white hover:text-slate-700">
                <X className="h-4.5 w-4.5 text-slate-400" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden bg-gradient-to-b from-white via-rose-50/15 to-violet-50/20">
              <ActiveOrders 
                myOrders={visibleMonitorOrders}
                readyCount={readyCount}
                selectedOrderIds={[]}
toggleOrderSelection={() => {}}
setShowBillDialog={() => {}}
                formatCurrency={formatCurrency}
                updateOrderStatus={updateOrderStatus}
                activeShift={activeShift}
                activeStaff={activeStaff}
                startAddingToOrder={(order) => {
                  if (!canManageHotelOrder(activeStaff, order)) {
                    toast.error("You can only open your own active orders");
                    return;
                  }
                  setAddingToOrder(order);
                  setShowMonitorDialog(false);
                  setRightTab("cart");
                }}
                addingToOrder={addingToOrder}
                onCollectPaymentReceipt={handleCollectedOrderReceipt}
                setCancellingOrder={() => {}}
              />
            </div>
          </DialogContent>
        </Dialog>
        
        
        <HotelCustomerSelectorDialog
          open={showCustomerDialog}
          onOpenChange={setShowCustomerDialog}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={setSelectedCustomer}
        />

        {/* POS Payment Dialog (Direct Payment) */}
        <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
          <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-5xl flex-col overflow-hidden rounded-md border border-slate-300 bg-white p-0 shadow-2xl" aria-describedby={undefined}>
            <div className="border-b border-slate-300 bg-slate-50 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-lg font-bold uppercase tracking-tight text-slate-900">Process Payment</DialogTitle>
                  <DialogDescription className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    Select payment method and finalize sale
                  </DialogDescription>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-slate-300 bg-white">
                  <CreditCard className="h-5 w-5 text-emerald-700" />
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-5">
                  <div className="flex items-center justify-between rounded-sm border border-slate-300 bg-slate-50 p-4">
                    <div className="flex flex-col">
                      <span className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Grand Total</span>
                      <span className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{formatCurrency(total)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Tax ({taxRate}%)</span>
                      <span className="text-lg font-semibold tabular-nums text-slate-600">{formatCurrency(taxAmount)}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-4">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Select Method</Label>
                    <RadioGroup 
                      value={paymentMethod} 
                      onValueChange={(v: any) => setPaymentMethod(v)}
                      className="grid grid-cols-2 gap-2"
                    >
                      {[
                        { id: 'cash', label: 'Cash', icon: Banknote },
                        { id: 'card', label: 'Card', icon: CreditCard },
                        { id: 'momo', label: 'Momo', icon: Smartphone },
                        { id: 'upi', label: 'UPI', icon: Zap },
                        { id: 'bank_transfer', label: 'Bank', icon: Building2 },
                      ].map((method) => (
                        <div key={method.id}>
                          <RadioGroupItem value={method.id} id={method.id} className="peer sr-only" />
                          <Label
                            htmlFor={method.id}
                            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-slate-300 bg-white p-4 transition-all duration-150 hover:bg-slate-50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/[0.04]"
                          >
                            <method.icon className={cn("h-5 w-5", paymentMethod === method.id ? "text-primary" : "text-slate-400")} />
                            <span className={cn("text-[11px] font-semibold uppercase tracking-[0.12em]", paymentMethod === method.id ? "text-primary" : "text-slate-600")}>
                              {method.label}
                            </span>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>

                    <div className="space-y-3">
                      <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Amount Received</Label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-semibold text-slate-300">$</span>
                        <Input
                          type="number"
                          placeholder={total.toString()}
                          value={paidAmount}
                          onChange={(e) => setPaidAmount(e.target.value)}
                          className="h-12 rounded-sm border-slate-300 bg-slate-50 pl-10 text-xl font-semibold focus-visible:ring-primary/20"
                        />
                      </div>
                      {paidAmount && Number(paidAmount) > total && (
                        <div className="flex items-center justify-between rounded-sm border border-emerald-200 bg-emerald-50 p-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Change Due</span>
                          <span className="text-lg font-semibold tabular-nums text-emerald-700">
                            {formatCurrency(Number(paidAmount) - total)}
                          </span>
                        </div>
                      )}

                      <Button 
                        onClick={handleProcessDirectPayment}
                        className="h-11 w-full gap-2 rounded-sm bg-emerald-600 text-[12px] font-semibold uppercase tracking-[0.12em] text-white shadow-none transition-all hover:bg-emerald-700"
                        disabled={isProcessing}
                      >
                        <CreditCard className="h-4 w-4" />
                        Pay Full {formatCurrency(total)}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

           <div className="flex items-center justify-between border-t border-slate-300 bg-slate-50 px-5 py-3">
              <Button 
                variant="ghost" 
                onClick={() => setShowPaymentDialog(false)}
                className="h-10 rounded-sm px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-700"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleProcessDirectPayment}
                disabled={isProcessing}
                className="h-10 gap-2 rounded-sm bg-emerald-600 px-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-none hover:bg-emerald-700"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Finalize & Post Sale
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Order Type Confirmation Dialog */}
        <Dialog
          open={showOrderTypeDialog}
          onOpenChange={(open) => {
            setShowOrderTypeDialog(open);
            if (!open) setPendingOrderType(null);
          }}
        >
          <DialogContent className="w-[92vw] max-w-md rounded-md border border-slate-300 bg-white p-0 shadow-2xl" aria-describedby={undefined}>
            <div className="border-b border-slate-300 bg-slate-50 px-5 py-4">
              <DialogTitle className="text-lg font-bold uppercase tracking-tight text-slate-900">
                {pendingOrderType === 'delivery'
                  ? 'Delivery Details'
                  : pendingOrderType === 'reservation'
                    ? 'Reservation Details'
                    : 'Confirm Takeaway'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                {pendingOrderType === 'delivery'
                  ? 'Enter delivery phone and address'
                  : pendingOrderType === 'reservation'
                    ? 'Enter reservation details'
                    : 'Confirm this is a takeaway order'}
              </DialogDescription>
            </div>

            <div className="space-y-3 p-5">
              {/* ─── TAKEAWAY: optional customer info ─── */}
              {pendingOrderType === 'takeaway' && (
                <>
                  {selectedCustomer ? (
                    <div className="space-y-2 rounded-sm border border-emerald-200 bg-emerald-50/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-emerald-600" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{selectedCustomer.name}</p>
                            {selectedCustomer.phone && (
                              <p className="text-xs text-slate-500 truncate">{selectedCustomer.phone}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCustomer(null)}
                          className="h-7 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-600 hover:bg-rose-100"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCustomerDialog(true)}
                      className="w-full h-9 gap-2 rounded-sm border-sky-200 bg-sky-50/50 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700 hover:bg-sky-100"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Select Existing Customer
                    </Button>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer Name (optional)</Label>
                    <Input value={takeawayCustomerName} onChange={(e) => setTakeawayCustomerName(e.target.value)} placeholder="Walk-in name" className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Phone (optional)</Label>
                    <Input value={takeawayCustomerPhone} onChange={(e) => setTakeawayCustomerPhone(e.target.value)} placeholder="e.g. 078xxxxxxx" className="h-10" />
                  </div>
                </>
              )}

              {/* ─── DELIVERY: customer info + payment plan ─── */}
              {pendingOrderType === 'delivery' && (
                <>
                  {selectedCustomer ? (
                    <div className="space-y-2 rounded-sm border border-emerald-200 bg-emerald-50/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-emerald-600" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{selectedCustomer.name}</p>
                            {selectedCustomer.phone && (
                              <p className="text-xs text-slate-500 truncate">{selectedCustomer.phone}</p>
                            )}
                            {selectedCustomer.address && (
                              <p className="text-xs text-slate-500 truncate">{selectedCustomer.address}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCustomer(null)}
                          className="h-7 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-600 hover:bg-rose-100"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCustomerDialog(true)}
                      className="w-full h-9 gap-2 rounded-sm border-violet-200 bg-violet-50/50 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700 hover:bg-violet-100"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Select Existing Customer
                    </Button>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer Name</Label>
                    <Input value={deliveryCustomerName} onChange={(e) => setDeliveryCustomerName(e.target.value)} placeholder="Customer name" className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Phone Number</Label>
                    <Input value={deliveryPhone} onChange={(e) => setDeliveryPhone(e.target.value)} placeholder="e.g. 078xxxxxxx" className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Delivery Address</Label>
                    <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Street, area, landmark" className="h-10" />
                  </div>
                </>
              )}

              {/* ─── RESERVATION: full details + deposit ─── */}
              {pendingOrderType === 'reservation' && (
                <>
                  {selectedCustomer ? (
                    <div className="space-y-2 rounded-sm border border-emerald-200 bg-emerald-50/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-emerald-600" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{selectedCustomer.name}</p>
                            {selectedCustomer.phone && (
                              <p className="text-xs text-slate-500 truncate">{selectedCustomer.phone}</p>
                            )}
                            {selectedCustomer.address && (
                              <p className="text-xs text-slate-500 truncate">{selectedCustomer.address}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCustomer(null)}
                          className="h-7 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-600 hover:bg-rose-100"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCustomerDialog(true)}
                      className="w-full h-9 gap-2 rounded-sm border-amber-200 bg-amber-50/50 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700 hover:bg-amber-100"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Select Existing Customer
                    </Button>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer Name</Label>
                    <Input value={reservationCustomerName} onChange={(e) => setReservationCustomerName(e.target.value)} placeholder="Customer name" className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Phone Number</Label>
                    <Input value={reservationCustomerPhone} onChange={(e) => setReservationCustomerPhone(e.target.value)} placeholder="Customer phone" className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer Address (optional)</Label>
                    <Input value={reservationCustomerAddress} onChange={(e) => setReservationCustomerAddress(e.target.value)} placeholder="Address" className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Call Date (auto)</Label>
                    <Input type="date" value={new Date().toISOString().split('T')[0]} disabled className="h-10 text-slate-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reservation Date</Label>
                      <Input type="date" value={reservationDate} onChange={(e) => setReservationDate(e.target.value)} className="h-10" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reservation Time</Label>
                      <Input type="time" value={reservationTime} onChange={(e) => setReservationTime(e.target.value)} className="h-10" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Party Size</Label>
                    <Input type="number" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Assign Waiter</Label>
                    <Select value={reservationAssignedWaiterId} onValueChange={setReservationAssignedWaiterId}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Choose a waiter" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeReservationWaiters.map((waiter) => (
                          <SelectItem key={waiter.id} value={waiter.id}>
                            {waiter.first_name} {waiter.last_name} ({waiter.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {activeReservationWaiters.length === 0 && (
                      <p className="text-xs text-rose-600">No active waiters are available right now.</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Deposit Amount (optional)</Label>
                    <Input type="number" min={0} step="0.01" value={reservationDeposit} onChange={(e) => setReservationDeposit(e.target.value)} placeholder="0.00" className="h-10" />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-300 bg-slate-50 px-5 py-3">
              <Button
                variant="ghost"
                onClick={() => { setShowOrderTypeDialog(false); setPendingOrderType(null); }}
                className="h-10 rounded-sm px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-700"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (pendingOrderType === 'delivery' && (!deliveryPhone || !deliveryAddress)) {
                    toast.error("Enter phone and address for delivery");
                    return;
                  }
                  if (pendingOrderType === 'reservation' && (!reservationCustomerName || !reservationDate || !reservationTime)) {
                    toast.error("Fill in name, date, and time for the reservation");
                    return;
                  }
                  if (pendingOrderType === 'reservation' && !reservationAssignedWaiterId) {
                    toast.error("Choose the waiter responsible for this reservation");
                    return;
                  }
                  setOrderType(pendingOrderType!);
                  setShowOrderTypeDialog(false);
                  setPendingOrderType(null);
                  toast.success(`Order type set to ${pendingOrderType}`);
                }}
                className="h-10 gap-2 rounded-sm bg-slate-800 px-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-none hover:bg-slate-700"
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirm
              </Button>
            </div>
          </DialogContent>
        </Dialog>



        {/* Shift Management Dialogs */}
        <OpenShiftDialog
          open={showOpenShiftDialog}
          onOpenChange={setShowOpenShiftDialog}
        />

        <CloseShiftDialog 
          open={showCloseShiftDialog} 
          onOpenChange={setShowCloseShiftDialog}
          activeShift={activeShift}
          activeStaff={activeStaff}
        />

        {/* Receipt Printing (Invisible trigger) */}
        {receiptData && (
          <HotelReceiptPrint 
            key={`${receiptData.invoiceNumber || 'receipt'}-${String(receiptData.saleDate || '')}-${receiptData.total || 0}`}
            {...receiptData}
            onPrintComplete={() => setReceiptData(null)}
          />
        )}

        {currentKOT && (
          <KOTPrint 
            key={`${currentKOT.station}-${currentKOT.orderNumber}-${currentKOT.type}-${currentKOT.timestamp.getTime()}`}
            data={currentKOT}
            onPrintComplete={() => setKotQueue((prevQueue) => prevQueue.slice(1))}
          />
        )}

      </div>
    </Layout>
  );
}

class HotelPOSErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[HotelPOS ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-100">
          <div className="max-w-md rounded-lg border border-rose-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-rose-700">HotelPOS crashed</h2>
            <p className="mt-2 text-sm text-slate-600">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <pre className="mt-3 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
              {this.state.error?.stack}
            </pre>
            <button
              className="mt-4 rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const HotelPOSWithErrorBoundary = (props: Record<string, never>) => (
  <HotelPOSErrorBoundary>
    <HotelPOS {...props} />
  </HotelPOSErrorBoundary>
);

export default HotelPOSWithErrorBoundary;
