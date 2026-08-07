import { useCancelOrderItem } from "@/hooks/useHotelOrders";
import { HotelInfo, HotelBooking, HotelOrder, HotelTableSession } from "@/types/hotel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { 
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { 
  Clock, User, Utensils, Printer, CheckCircle2, 
  XCircle, Receipt, Plus, AlertCircle, 
  ChefHat, GlassWater, Package, ArrowRight, Search,
  Banknote, ClipboardCheck, ShieldCheck, CreditCard,
  Smartphone, Building2, SplitSquareHorizontal, CheckCircle,
  UserRound
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { memo, useEffect, useMemo, useState, useCallback } from "react";
import { printOrderInvoice } from "@/utils/orderInvoicePdf";
import { useHotelInfo } from "@/hooks/useHotel";
import { toast } from "sonner";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { KOTPrint, KOTData } from "@/components/hotel/KOTPrint";
import { HotelCustomerSelectorDialog } from "@/components/hotel/HotelCustomerSelectorDialog";
import { SplitBillDialog } from "./SplitBillDialog";
import { type Customer } from "@/hooks/useCustomers";
import { useQueryClient } from "@tanstack/react-query";
import { printReceipt } from "@/hooks/useHotelServices";
import { syncService } from "@/lib/syncService";
import { apiClient } from "@/integrations/supabase/client";
import { getLocalItem, getLocalData, saveLocalData } from "@/lib/localDataService";
import { setHotelTableStatus, releaseHotelTableIfNoActiveOrders } from "@/hooks/useHotelOrders";

const Bell = memo(({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="24" 
    height="24" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
));

const orderStatusConfig: Record<string, { label: string; color: string; glow: string; icon: any }> = {
  pending: { label: "PENDING", color: "text-rose-600", glow: "shadow-rose-200/60", icon: Clock },
  preparing: { label: "PREPARING", color: "text-amber-600", glow: "shadow-amber-200/60", icon: ChefHat },
  ready: { label: "READY", color: "text-emerald-600", glow: "shadow-emerald-200/60", icon: Bell },
  served: { label: "SERVED", color: "text-blue-600", glow: "shadow-blue-200/60", icon: CheckCircle2 },
  awaiting_approval: { label: "VERIFICATION PENDING", color: "text-violet-600", glow: "shadow-violet-200/60", icon: ClipboardCheck },
  pending_handover: { label: "PENDING HANDOVER", color: "text-violet-600", glow: "shadow-violet-200/60", icon: ClipboardCheck },
  confirmed: { label: "CONFIRMED", color: "text-teal-700", glow: "shadow-teal-200/60", icon: ShieldCheck },
  paid: { label: "PAID", color: "text-emerald-700", glow: "shadow-emerald-200/60", icon: Banknote },
  settled: { label: "SETTLED", color: "text-teal-700", glow: "shadow-teal-200/60", icon: ShieldCheck },
  cancelled: { label: "CANCELLED", color: "text-red-600", glow: "shadow-red-200/60", icon: XCircle },
  billed: { label: "BILLED", color: "text-indigo-600", glow: "shadow-indigo-200/60", icon: Receipt },
};

interface ActiveOrdersProps {
  myOrders: HotelOrder[];
  readyCount: number;
  selectedOrderIds: string[];
  toggleOrderSelection: (id: string) => void;
  setShowBillDialog: (show: boolean) => void;
  formatCurrency: (v: number) => string;
  updateOrderStatus: any;
  activeShift: any;
  activeStaff: any;
  startAddingToOrder: (order: HotelOrder) => void;
  addingToOrder: HotelOrder | null;
  onCollectPaymentReceipt?: (order: HotelOrder, paymentMethod: string) => void;
  setCancellingOrder: (order: HotelOrder) => void;
}

export const ActiveOrders = memo(({
  myOrders, readyCount, selectedOrderIds, toggleOrderSelection,
  setShowBillDialog, formatCurrency, updateOrderStatus,
  activeShift, activeStaff, startAddingToOrder, addingToOrder, onCollectPaymentReceipt, setCancellingOrder
}: ActiveOrdersProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [collectingOrder, setCollectingOrder] = useState<HotelOrder | null>(null);
  const [detailsOrder, setDetailsOrder] = useState<HotelOrder | null>(null);
  const [cancellingItem, setCancellingItem] = useState<{ id: string; name: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerSelector, setShowCustomerSelector] = useState(false);
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [splitBillOrder, setSplitBillOrder] = useState<HotelOrder | null>(null);
  const [now, setNow] = useState(Date.now());
  const [currentKOT, setCurrentKOT] = useState<KOTData | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);

  // ─── FIX: local items map for hydrating orders that have no items attached ───
  const [localItemsMap, setLocalItemsMap] = useState<Record<string, any[]>>({});

 const missingItemsOrderIds = useMemo(
  () => myOrders.filter(o => !o.items?.length).map(o => o.id).join(','),
  [myOrders]
);

useEffect(() => {
  if (!missingItemsOrderIds) return;
  let cancelled = false;

  const hydrateFromLocal = async () => {
    try {
      const allItems = await getLocalData<any>('hotel_order_items');
      if (cancelled || !allItems?.length) return;

      const neededIds = new Set(missingItemsOrderIds.split(','));
      const map: Record<string, any[]> = {};
      for (const item of allItems) {
        if (!neededIds.has(item.order_id)) continue;
        if (!map[item.order_id]) map[item.order_id] = [];
        map[item.order_id].push(item);
      }
      setLocalItemsMap(prev => ({ ...prev, ...map }));
    } catch {
      // silent
    }
  };

  hydrateFromLocal();
  return () => { cancelled = true; };
}, [missingItemsOrderIds]);
  // ─────────────────────────────────────────────────────────────────────────────

  const cancelOrderItem = useCancelOrderItem();
  const { data: hotelInfo } = useHotelInfo();
  const { receiptSettings, getCurrencySymbol } = useSettingsContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  // ─── FIX: getVisibleItems now falls back to localItemsMap ─────────────────
  const getVisibleItems = useCallback(
    (order?: HotelOrder | null) => {
      const items =
        order?.items?.length
          ? order.items
          : (localItemsMap[order?.id ?? ''] ?? []);
      return items.filter((item: any) => item.status !== "cancelled");
    },
    [localItemsMap]
  );
  // ─────────────────────────────────────────────────────────────────────────────

  const buildPrintableOrder = useMemo(
    () => (order: HotelOrder) => ({
      ...order,
      items: getVisibleItems(order),
    }),
    [getVisibleItems]
  );

  useEffect(() => {
    if (collectingOrder) {
      setPaymentMethod("cash");
      setSelectedCustomer(null);
    }
  }, [collectingOrder]);

  const handleCollect = async () => {
    if (!collectingOrder) return;
    if (isCollecting) return;

    const isTakeawayOrder = ['takeaway', 'delivery', 'reservation'].includes(collectingOrder.order_type || '');
    setIsCollecting(true);

    try {
      const paymentTimestamp = new Date().toISOString();
      const customerData = selectedCustomer ? {
        id: selectedCustomer.id,
        name: selectedCustomer.name,
        phone: selectedCustomer.phone,
        email: selectedCustomer.email,
        address: selectedCustomer.address,
        tin_number: selectedCustomer.tin_number
      } : undefined;

      const orderId = collectingOrder.id;
      const totalAmount = Number(collectingOrder.total_amount || 0);

      if (isTakeawayOrder) {
        // ─── TAKEAWAY / DELIVERY / RESERVATION: mark as paid, then route to POS Handle ───
        await syncService.performOperation('hotel_orders', 'update', {
          id: orderId,
          status: 'paid',
          is_billed: true,
          payment_method: paymentMethod,
          payment_received_at: paymentTimestamp,
          amount_paid: totalAmount,
          updated_at: paymentTimestamp,
          customer_id: customerData?.id || collectingOrder.customer_id,
          customer_name: customerData?.name || collectingOrder.customer_name,
          customer_phone: customerData?.phone || collectingOrder.customer_phone,
          customer_email: customerData?.email || collectingOrder.customer_email,
          customer_address: customerData?.address || collectingOrder.customer_address,
          customer_tin: customerData?.tin_number || collectingOrder.customer_tin
        });

        queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });

        toast.success('Payment collected — order moved to POS Handle for settlement');
        setCollectingOrder(null);
        setSelectedCustomer(null);
        return;
      }

      // ─── DINE-IN: Mark order as pending_handover for cashier to settle ───
      await syncService.performOperation('hotel_orders', 'update', {
        id: orderId,
        status: 'pending_handover',
        is_billed: true,
        payment_method: paymentMethod,
        payment_received_at: paymentTimestamp,
        updated_at: paymentTimestamp,
        customer_id: customerData?.id || collectingOrder.customer_id,
        customer_name: customerData?.name || collectingOrder.customer_name,
        customer_phone: customerData?.phone || collectingOrder.customer_phone,
        customer_email: customerData?.email || collectingOrder.customer_email,
        customer_address: customerData?.address || collectingOrder.customer_address,
        customer_tin: customerData?.tin_number || collectingOrder.customer_tin
      });

      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });

      toast.success('Payment collected — order moved to POS Handle for settlement');

      setCollectingOrder(null);
      setSelectedCustomer(null);
    } catch (error) {
      console.error("Failed to collect payment:", error);
      toast.error('Failed to collect payment');
    } finally {
      setIsCollecting(false);
    }
  };

  const filteredOrders = useMemo(() => {
    if (!searchTerm.trim()) return myOrders;
    
    const term = searchTerm.toLowerCase();
    return myOrders.filter(order => {
      const orderNum = order.order_number?.toString().toLowerCase() || "";
      const tableNum = order.table_number?.toString().toLowerCase() || "";
      const roomNum = order.room?.room_number?.toString().toLowerCase() || "";
      const guestName = `${order.booking?.guest?.first_name || ""} ${order.booking?.guest?.last_name || ""}`.toLowerCase();
      
      return orderNum.includes(term) || 
             tableNum.includes(term) || 
             roomNum.includes(term) || 
             guestName.includes(term);
    });
  }, [myOrders, searchTerm]);

  const selectedOrderIdSet = useMemo(() => new Set(selectedOrderIds), [selectedOrderIds]);

  const visibleOrders = useMemo(
    () => filteredOrders.filter((order) => {
      // Exclude any order that's already paid, billed, settled, or cancelled
     const isOrderDone = 
  ["billed", "paid", "settled", "cancelled"].includes(order.status) ||
  (["served", "pending_handover"].includes(order.status) && !!order.is_billed);
      const sessionAlreadyPaid =
        !!order.session_id &&
        (order.session?.payment_status === 'paid' || order.session?.status === 'closed');

      return !isOrderDone && !sessionAlreadyPaid;
    }),
    [filteredOrders]
  );

  const liveDetailsOrder = useMemo(
    () => (detailsOrder ? myOrders.find((order) => order.id === detailsOrder.id) || null : null),
    [detailsOrder, myOrders]
  );

  useEffect(() => {
    if (detailsOrder && !liveDetailsOrder) {
      setDetailsOrder(null);
      setCancellingItem(null);
      setCancelReason("");
    }
  }, [detailsOrder, liveDetailsOrder]);

  const canCancelOrder = (order: HotelOrder) => {
    const isManager = ["manager", "owner", "admin"].includes(activeStaff?.role?.toLowerCase() || "");
    const isWaiter = activeStaff?.role === "waiter";
    const isOwner = !!activeStaff?.staff_id && [order.waiter_id, order.staff_id].includes(activeStaff.staff_id);
    const cancellableStatus = ["pending", "preparing", "ready", "served"].includes(order.status);
    
    // Managers can cancel anytime if status is cancellable
    if (isManager && cancellableStatus) return { allowed: true };
    
    // Waiters can cancel if they are the owner and status is cancellable (no grace period limit anymore)
    if (isWaiter && isOwner && cancellableStatus) {
      return { allowed: true };
    }
    
    return { allowed: false };
  };

  const canCollectPayment = (order: HotelOrder) =>
    ["pending", "preparing", "ready", "served"].includes(order.status);

  const canMarkServed = (order: HotelOrder) => order.status === "ready";

  const getCancelTimeRemaining = (order: HotelOrder) => {
    const remainingMs = Math.max(0, (new Date(order.created_at).getTime() + 10 * 60 * 1000) - now);
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    return {
      remainingMs,
      label: `${minutes}m ${seconds.toString().padStart(2, "0")}s`,
    };
  };

  const submitOrderCancel = () => {
    if (!liveDetailsOrder) return;
    const { allowed } = canCancelOrder(liveDetailsOrder);
    
    if (!allowed) {
      toast.error("You are not allowed to cancel this order.");
      return;
    }

    if (!cancelReason.trim()) {
      toast.error("Provide a cancellation reason");
      return;
    }
  

    updateOrderStatus.mutate({
      orderId: liveDetailsOrder.id,
      status: "cancelled",
      cancelReason: cancelReason.trim(),
      staffId: activeStaff?.staff_id || null,
      shiftId: activeShift.id,
    }, {
      onSuccess: () => {
        // Print cancellation KOTs
        const allItems = getVisibleItems(liveDetailsOrder);
        const kitchenItems = allItems.filter((item: any) => item.station === 'kitchen');
        const barItems = allItems.filter((item: any) => item.station === 'bar');

        if (kitchenItems.length > 0) {
          setCurrentKOT({
            orderNumber: `#${liveDetailsOrder.order_number.toString().slice(-4)}`,
            type: 'cancelled',
            station: 'kitchen',
            tableNumber: liveDetailsOrder.table_number,
            roomNumber: liveDetailsOrder.room?.room_number,
            waiterName: activeStaff?.first_name,
            items: kitchenItems.map((i: any) => ({ name: i.name, quantity: i.quantity, notes: i.notes })),
            cancelReason: cancelReason.trim(),
            timestamp: new Date()
          });
        }

        if (barItems.length > 0) {
          setTimeout(() => {
            setCurrentKOT({
              orderNumber: `#${liveDetailsOrder.order_number.toString().slice(-4)}`,
              type: 'cancelled',
              station: 'bar',
              tableNumber: liveDetailsOrder.table_number,
              roomNumber: liveDetailsOrder.room?.room_number,
              waiterName: activeStaff?.first_name,
              items: barItems.map((i: any) => ({ name: i.name, quantity: i.quantity, notes: i.notes })),
              cancelReason: cancelReason.trim(),
              timestamp: new Date()
            });
          }, kitchenItems.length > 0 ? 1000 : 0);
        }
      }
    });
    setDetailsOrder(null);
    setCancelReason("");
  };

  const submitItemCancel = () => {
    if (!cancellingItem || !liveDetailsOrder) return;
    const { allowed } = canCancelOrder(liveDetailsOrder);

    if (!allowed) {
      toast.error("You are not allowed to cancel this item.");
      return;
    }

    if (!cancelReason.trim()) {
      toast.error("Provide a cancellation reason");
      return;
    }
    if (!activeShift?.id) {
      toast.error("Open a shift before cancelling items");
      return;
    }

    cancelOrderItem.mutate({
      itemId: cancellingItem.id,
      staffId: activeStaff?.staff_id,
      shiftId: activeShift?.id,
      cancelReason: cancelReason.trim()
    }, {
      onSuccess: () => {
        // Print individual item cancellation KOT
        const allItems = [
          ...(liveDetailsOrder.items || []),
          ...(localItemsMap[liveDetailsOrder.id] || []),
        ];
        const item = allItems.find((i: any) => i.id === cancellingItem.id);
        if (item) {
          setCurrentKOT({
            orderNumber: `#${liveDetailsOrder.order_number.toString().slice(-4)}`,
            type: 'cancelled',
            station: item.station as 'kitchen' | 'bar',
            tableNumber: liveDetailsOrder.table_number,
            roomNumber: liveDetailsOrder.room?.room_number,
            waiterName: activeStaff?.first_name,
            items: [{ name: item.name, quantity: item.quantity, notes: item.notes }],
            cancelReason: cancelReason.trim(),
            timestamp: new Date()
          });
        }
      }
    });
    setCancellingItem(null);
    setCancelReason("");
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-white via-rose-50/20 to-violet-50/25">
      <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200/70 bg-white/95 px-3 py-3 md:gap-3 md:px-4 md:py-4">
        {selectedOrderIds.length > 0 && (
          <div className="flex items-center justify-end">
            <Button 
              size="sm" 
              onClick={() => setShowBillDialog(true)}
              className="h-8 rounded-sm bg-rose-400 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-none hover:bg-rose-500 md:h-9 md:px-4 md:text-[11px]"
            >
              <Receipt className="mr-2 h-3.5 w-3.5 md:h-4 md:w-4" /> Bill ({selectedOrderIds.length})
            </Button>
          </div>
        )}

        <div className="relative group">
          <div className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-2 md:left-4">
            <Search className="h-3.5 w-3.5 text-slate-400 transition-colors group-focus-within:text-rose-500 md:h-4 md:w-4" />
            <div className="h-3 w-px bg-slate-200 md:h-4" />
          </div>
          <Input 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search room, table, guest..." 
            className="h-9 rounded-sm border-slate-200/80 bg-white pl-11 pr-3 text-[11px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-rose-200 focus:bg-white focus:ring-0 md:h-11 md:pl-14 md:pr-4 md:text-[12px]"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="h-full space-y-3 p-3 pb-20 md:space-y-4 md:p-4 md:pb-6">
          {visibleOrders.length === 0 ? (
            <div className="flex h-[280px] flex-col items-center justify-center text-slate-400">
              <div className="mb-4 rounded-full bg-rose-50/70 p-5">
                <Package className="h-10 w-10 text-rose-200" />
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {searchTerm ? "No matching orders found" : "No active orders right now"}
              </p>
            </div>
          ) : (

            visibleOrders.map((order) => {
              const status = orderStatusConfig[order.status] || orderStatusConfig.pending;
              const StatusIcon = status.icon;
              const isSelected = selectedOrderIdSet.has(order.id);
              const visibleItems = getVisibleItems(order);
              const cancelAccess = canCancelOrder(order);
              const sessionAlreadyPaid =
                !!order.session_id &&
                (order.session?.payment_status === 'paid' || order.session?.status === 'closed');
              
              const isRecentlyCancelled = order.status === 'cancelled' && order.updated_at && 
                (now - new Date(order.updated_at).getTime() < 15 * 60 * 1000);

              return (
                <div 
                  key={order.id}
                  className={cn(
                    "group relative overflow-hidden rounded-md border bg-white/95 transition-all duration-150",
                    isSelected 
                      ? "border-rose-200 bg-white shadow-[0_8px_22px_rgba(244,114,182,0.10)]"
                      : order.status === 'cancelled'
                        ? "border-red-200 bg-red-50/30"
                        : "border-slate-200/80 hover:border-rose-150 hover:bg-white"
                  )}
                >
                  <div className={cn("absolute left-0 top-0 h-full w-1.5 opacity-50", 
                    order.status === 'cancelled' ? "bg-red-500" : status.color.replace('text-', 'bg-')
                  )} />

                  <div className="p-3 md:p-5">
                    <div className="mb-3 flex flex-col items-start justify-between gap-3 lg:mb-4 lg:flex-row lg:gap-4">
                      <div className="flex w-full items-start gap-3 md:items-center lg:w-auto md:gap-4">
                        <div 
                          onClick={() => toggleOrderSelection(order.id)}
                          className={cn(
                            "relative flex h-12 w-12 shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-sm border transition-all duration-150 md:h-14 md:w-14",
                            isSelected 
                              ? "border-rose-200 bg-rose-50/40 text-rose-600"
                              : "border-slate-200/80 bg-white text-slate-500 group-hover:border-rose-150 group-hover:text-rose-500"
                          )}
                        >
                          <span className="mb-0.5 text-[7px] font-semibold uppercase tracking-[0.18em] opacity-70 md:text-[8px]">Order</span>
                          <span className="text-xs font-semibold tracking-tight md:text-sm">#{order.order_number.toString().slice(-4)}</span>
                        </div>
                        
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 md:mb-2 md:gap-2">
                            <h4 className="truncate text-base font-semibold leading-none text-slate-900 md:text-xl">
                              {order.room?.room_number ? `R-${order.room.room_number}` : `T-${order.table_number || 'WI'}`}
                            </h4>
                            <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                              <Badge className={cn(
                                "rounded-sm border px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.12em] md:px-2 md:py-1 md:text-[9px]", 
                                status.color.replace('text-', 'bg-') + "/10", 
                                status.color,
                                "border-current/10"
                              )}>
                                <StatusIcon className="mr-1 h-2.5 w-2.5 inline md:mr-1.5 md:h-3 md:w-3" />
                                {status.label}
                              </Badge>

                              {isRecentlyCancelled && (
                                <Badge className="rounded-sm border border-red-200 bg-red-100 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.12em] text-red-700 animate-pulse md:px-2 md:py-1 md:text-[9px]">
                                  <XCircle className="mr-1 h-2.5 w-2.5 inline md:mr-1.5 md:h-3 md:w-3" />
                                  RECENTLY CANCELLED
                                </Badge>
                              )}
                              
                              <div className="flex items-center gap-1.5">
                                {/* ─── FIX: check localItemsMap too for station badges ─── */}
                                {(order.items?.length
                                  ? order.items
                                  : (localItemsMap[order.id] ?? [])
                                ).some((i: any) => i.station === 'kitchen') && (
                                  <div className={cn(
                                    "rounded-sm border px-2 py-0.5 text-[8px] font-semibold tracking-[0.12em]",
                                    order.kitchen_status === 'ready' ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
                                    order.kitchen_status === 'preparing' ? "border-amber-200 bg-amber-50 text-amber-700" :
                                    "border-slate-200 bg-slate-50 text-slate-500"
                                  )}>
                                    KTN
                                  </div>
                                )}
                                {(order.items?.length
                                  ? order.items
                                  : (localItemsMap[order.id] ?? [])
                                ).some((i: any) => i.station === 'bar') && (
                                  <div className={cn(
                                    "rounded-sm border px-2 py-0.5 text-[8px] font-semibold tracking-[0.12em]",
                                    order.bar_status === 'ready' ? "border-blue-200 bg-blue-50 text-blue-700" :
                                    order.bar_status === 'preparing' ? "border-amber-200 bg-amber-50 text-amber-700" :
                                    "border-slate-200 bg-slate-50 text-slate-500"
                                  )}>
                                    BAR
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1.5 rounded-sm bg-rose-50/40 px-2 py-1">
                                <User className="h-3 w-3 text-slate-400" />
                                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.12em]">
                                  {order.booking?.guest?.first_name || 'Walk-in'} {order.booking?.guest?.last_name || ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 rounded-sm bg-violet-50/30 px-2 py-1">
                                <Clock className="h-3 w-3 text-slate-400" />
                                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.12em] tabular-nums">
                                  {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                                </span>
                              </div>
                              {order.status === 'cancelled' && (
                                <div className="flex items-center gap-1.5 rounded-sm bg-red-50 px-2 py-1 border border-red-100/50">
                                  <AlertCircle className="h-3 w-3 text-red-500" />
                                  <span className="text-[10px] font-bold text-red-600 uppercase tracking-[0.12em]">
                                    Reason: {order.cancel_reason || 'N/A'}
                                  </span>
                                </div>
                              )}
                              {cancelAccess.allowed && (
                                <div className="flex items-center gap-1.5 rounded-sm bg-rose-50 px-2 py-1 animate-pulse">
                                  <AlertCircle className="h-3 w-3 text-rose-500" />
                                  <span className="text-[10px] font-bold text-rose-600 uppercase tracking-[0.12em] tabular-nums">
                                    Cancel: {getCancelTimeRemaining(order).label}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex w-full flex-col items-start border-t border-slate-100 pt-3 lg:w-auto lg:items-end lg:border-t-0 lg:pt-0">
                        <span className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Order Total</span>
                        <span className="text-2xl font-semibold leading-none text-slate-950 tabular-nums md:text-[28px]">
                          {formatCurrency(order.total_amount)}
                        </span>
                      </div>
                    </div>

                    {/* ─── Items grid — now always populated via getVisibleItems fallback ─── */}
                    <div className="mb-3 grid grid-cols-1 gap-1.5 md:mb-4 md:grid-cols-2 md:gap-2">
                      {visibleItems.length === 0 ? (
                        <div className="col-span-2 rounded-sm border border-dashed border-slate-200 bg-slate-50/50 px-3 py-3 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
                          Loading items…
                        </div>
                      ) : (
                        visibleItems.map((item: any, idx: number) => (
                          <div key={item.id ?? idx} className={cn(
                            "flex items-center justify-between rounded-sm border px-2 py-1.5 transition-colors hover:bg-white md:px-3 md:py-2.5",
                            item.status === 'cancelled' 
                              ? "bg-red-500/10 border-red-200" 
                              : "border-slate-200/80 bg-slate-50/45"
                          )}>
                            <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
                              <div className={cn(
                                "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border text-[10px] font-semibold md:h-7 md:w-7 md:text-[11px]",
                                item.status === 'ready' ? "border-emerald-200 bg-emerald-100 text-emerald-700" : 
                                item.status === 'cancelled' ? "border-red-200 bg-red-50 text-red-600" :
                                "border-rose-200 bg-rose-50 text-rose-600"
                              )}>
                                {item.status === 'ready' ? <CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4" /> : item.quantity}
                              </div>
                              <div className="flex min-w-0 flex-col">
                                <span className={cn(
                                  "truncate text-[10px] font-semibold uppercase tracking-tight md:text-[11px]",
                                  (item.status === 'ready' || item.status === 'cancelled') ? "text-slate-400 line-through" : "text-slate-800"
                                )}>
                                  {item.name}
                                  {item.status === 'cancelled' && <span className="ml-1 text-red-500 font-bold animate-pulse">!!! CANCELLED !!!</span>}
                                </span>
                                {(item.notes || item.status === 'cancelled') && (
                                  <span className={cn(
                                    "truncate text-[8px] font-medium uppercase tracking-[0.12em] md:text-[9px]",
                                    item.status === 'cancelled' ? "text-red-500" : "text-rose-500/80"
                                  )}>
                                    {item.status === 'cancelled' ? `[REASON: ${item.cancel_reason || 'N/A'}]` : `[${item.notes}]`}
                                  </span>
                                )}
                                {(item.seat_no || item.payment_group_id) && item.status !== 'cancelled' && (
                                  <span className="truncate text-[8px] font-medium uppercase tracking-[0.12em] text-violet-600 md:text-[9px]">
                                    {item.seat_no ? `Seat ${item.seat_no}` : 'Grouped bill'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="ml-1.5 flex items-center gap-1.5 md:ml-2 md:gap-2">
                              <Badge variant="outline" className={cn(
                                "rounded-sm border px-1.5 py-0.5 text-[7px] font-semibold tracking-[0.12em] md:px-2 md:py-0.5 md:text-[8px]",
                                item.status === 'ready' ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
                                item.status === 'preparing' ? "bg-amber-50 text-amber-600 border-amber-200" :
                                item.status === 'cancelled' ? "bg-red-50 text-red-600 border-red-200" :
                                "bg-slate-100 text-slate-500 border-slate-200"
                              )}>
                                {item.status?.toUpperCase()}
                              </Badge>

                              {cancelAccess.allowed && item.status !== 'cancelled' && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailsOrder(order);
                                    setCancellingItem({ id: item.id, name: item.name });
                                    setCancelReason("");
                                  }}
                                  disabled={cancelOrderItem.isPending}
                                  className="h-6 w-6 rounded-sm text-rose-400 hover:bg-rose-50 hover:text-rose-600 md:h-7 md:w-7"
                                >
                                  <XCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDetailsOrder(order);
                          setCancelReason("");
                        }}
                        className="h-8 rounded-sm border-slate-200 bg-white px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 shadow-none transition-all hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600 md:h-10 md:px-3 md:text-[11px]"
                      >
                        DETAILS
                      </Button>
                      <Button 
                        size="sm"
                        variant="outline"
                        disabled={order.status === 'awaiting_approval' || order.status === 'pending_handover' || order.status === 'confirmed' || order.status === 'paid' || order.status === 'settled'}
                        onClick={() => startAddingToOrder(order)}
                        className="h-8 flex-1 rounded-sm border-slate-200 bg-white text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 shadow-none transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 md:h-10 md:text-[11px]"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1.5 md:h-4 md:w-4 md:mr-2" /> ADD ITEMS
                      </Button>
                      <Button 
                        size="sm"
                        variant="outline"
                        disabled={order.status === 'awaiting_approval' || order.status === 'pending_handover' || order.status === 'confirmed' || order.status === 'paid' || order.status === 'settled' || !!collectingOrder || !!splitBillOrder}
                        onClick={() => {
                          setSplitBillOrder(order);
                          setShowSplitBill(true);
                        }}
                        className="h-8 rounded-sm border-slate-200 bg-white px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 shadow-none transition-all hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-50 md:h-10 md:px-3 md:text-[11px]"
                      >
                        <SplitSquareHorizontal className="h-3.5 w-3.5 mr-1.5 md:h-4 md:w-4 md:mr-2" /> SPLIT
                      </Button>
                      <Button 
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          printOrderInvoice(
                            buildPrintableOrder(order), 
                            hotelInfo, 
                            getCurrencySymbol(), 
                            receiptSettings?.paper_size as any || 'A4',
                            receiptSettings?.invoice_style as any || 'formal'
                          );
                        }}
                        className="h-8 w-8 rounded-sm border-slate-200 bg-white p-0 text-slate-500 shadow-none transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 md:h-10 md:w-10"
                      >
                        <Printer className="h-3.5 w-3.5 md:h-4.5 md:w-4.5" />
                      </Button>
                      
                      {['takeaway', 'delivery', 'reservation'].includes(order.order_type || '') ? (
        <div className="flex h-8 flex-[2] min-w-[100px] items-center justify-center rounded-sm border border-slate-200 bg-amber-50 px-3 md:h-10 md:px-4">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700 md:text-[11px]">
            HANDLE VIA POS HANDLE
          </span>
        </div>
      ) : canCollectPayment(order) ? (
        <>
          {canMarkServed(order) && (
            <Button 
              size="sm"
              onClick={() => updateOrderStatus.mutate({ orderId: order.id, status: 'served' })}
              disabled={!!collectingOrder || !!splitBillOrder}
              className="h-8 flex-1 min-w-[100px] rounded-sm bg-emerald-500 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-none hover:bg-emerald-600 md:h-10 md:text-[11px]"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 md:h-4 md:w-4 md:mr-2" /> MARK SERVED
            </Button>
          )}
          <Button 
            size="sm"
            onClick={() => setCollectingOrder(order)}
            disabled={!!collectingOrder || !!splitBillOrder}
            className="h-8 flex-1 min-w-[100px] rounded-sm bg-rose-500 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-none hover:bg-rose-600 md:h-10 md:text-[11px]"
          >
            <Banknote className="h-3.5 w-3.5 mr-1.5 md:h-4 md:w-4 md:mr-2" /> COLLECT tPAYMENT
          </Button>
        </>
      ) : (
                        <div className="flex h-8 flex-[2] min-w-[100px] items-center justify-center rounded-sm border border-slate-200 bg-slate-50 px-3 md:h-10 md:px-4">
                           <StatusIcon className={cn("mr-1.5 h-3.5 w-3.5 md:mr-2 md:h-4 md:w-4", status.color)} />
                           <span className={cn("text-[9px] font-semibold uppercase tracking-[0.12em] md:text-[10px]", status.color)}>{status.label}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Payment Method Dialog */}
      <Dialog open={!!collectingOrder} onOpenChange={(open) => !open && setCollectingOrder(null)}>
        <DialogContent className="overflow-hidden rounded-md border border-slate-300 bg-white p-0 shadow-2xl sm:max-w-[400px]" aria-describedby={undefined}>
          <div className="border-b border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-semibold uppercase tracking-[0.08em] text-slate-900">Collect Payment</DialogTitle>
                <DialogDescription className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                  Order #{collectingOrder?.order_number?.toString().slice(-4)} • Total: {collectingOrder ? formatCurrency(collectingOrder.total_amount) : ''}
                </DialogDescription>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-rose-200 bg-rose-50">
                <Banknote className="h-5 w-5 text-rose-500" />
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Customer (Optional)</Label>
              <Button
                variant="outline"
                onClick={() => setShowCustomerSelector(true)}
                className="flex w-full items-center justify-between border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate text-xs font-medium">
                    {selectedCustomer ? selectedCustomer.name : "Walk-in Guest"}
                  </span>
                </div>
                <Plus className="h-3.5 w-3.5 text-slate-400" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Payment Method</Label>
              <RadioGroup 
                value={paymentMethod} 
                onValueChange={setPaymentMethod} 
                className="grid grid-cols-2 gap-2"
              >
                {[
                  { id: 'cash', label: 'Cash', icon: Banknote, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                  { id: 'card', label: 'Card', icon: CreditCard, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { id: 'momo', label: 'Momo', icon: Smartphone, color: 'text-rose-500', bg: 'bg-rose-50' },
                  { id: 'upi', label: 'UPI', icon: Banknote, color: 'text-violet-600', bg: 'bg-violet-50' },
                ].map((method) => (
                  <div key={method.id} className="relative">
                    <RadioGroupItem value={method.id} id={`collect-${method.id}`} className="peer sr-only" />
                    <Label
                      htmlFor={`collect-${method.id}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-sm border p-3 transition-all duration-150",
                        paymentMethod === method.id 
                          ? "border-rose-300 bg-rose-50" 
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      <div className={cn("flex h-8 w-8 items-center justify-center rounded-sm", method.bg, method.color)}>
                        <method.icon className="h-4 w-4" />
                      </div>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">{method.label}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <Button 
              onClick={handleCollect}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-rose-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-none hover:bg-rose-600"
            >
              <CheckCircle className="h-4 w-4" />
              Confirm Collection
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!detailsOrder}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsOrder(null);
            setCancelReason("");
          }
        }}
      >
        <DialogContent className="flex max-h-[96vh] w-[96vw] flex-col overflow-hidden rounded-md border border-slate-200 bg-white p-0 shadow-2xl sm:max-h-[88vh] sm:max-w-2xl" aria-describedby={undefined}>
          <div className="shrink-0 border-b border-slate-200/80 bg-gradient-to-r from-rose-50/50 via-white to-violet-50/40 p-4 md:p-5">
            <DialogTitle className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-900 md:text-base">
              Order Details
            </DialogTitle>
            <DialogDescription className="mt-1 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500 md:text-[10px]">
              {detailsOrder ? `Order #${detailsOrder.order_number.toString().slice(-4)}` : ""}
            </DialogDescription>
          </div>

          {liveDetailsOrder && (
            <div className="flex-1 overflow-y-auto p-4 md:p-5">
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                <div className="rounded-sm border border-slate-200 bg-slate-50/60 p-2 md:p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:text-[10px]">Location</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-900 md:mt-1 md:text-sm">
                    {liveDetailsOrder.room?.room_number ? `Room ${liveDetailsOrder.room.room_number}` : `Table ${liveDetailsOrder.table_number || "Walk-in"}`}
                  </p>
                </div>
                <div className="rounded-sm border border-slate-200 bg-slate-50/60 p-2 md:p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:text-[10px]">Placed</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-900 md:mt-1 md:text-sm">
                    {formatDistanceToNow(new Date(liveDetailsOrder.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="rounded-sm border border-slate-200 bg-slate-50/60 p-2 md:p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:text-[10px]">Guest</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-900 md:mt-1 md:text-sm">
                    {liveDetailsOrder.booking?.guest?.first_name || "Walk-in"} {liveDetailsOrder.booking?.guest?.last_name || ""}
                  </p>
                </div>
                <div className="rounded-sm border border-slate-200 bg-slate-50/60 p-2 md:p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:text-[10px]">Total</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-900 md:mt-1 md:text-sm">
                    {formatCurrency(liveDetailsOrder.total_amount)}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-sm border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-3 py-2 md:px-4 md:py-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:text-[10px]">Items</p>
                </div>
                <div className="space-y-1.5 p-3 md:space-y-2 md:p-4">
                  {getVisibleItems(liveDetailsOrder).map((item: any, idx: number) => (
                    <div key={item.id ?? idx} className={cn(
                      "flex items-center justify-between rounded-sm border px-2 py-1.5 md:px-3 md:py-2",
                      item.status === 'cancelled' ? "bg-red-500/10 border-red-200" : "border-slate-200 bg-slate-50/50"
                    )}>
                      <div className="min-w-0">
                        <p className={cn(
                          "truncate text-xs font-semibold md:text-sm",
                          item.status === 'cancelled' ? "text-slate-400 line-through" : "text-slate-900"
                        )}>
                          {item.name}
                          {item.status === 'cancelled' && <span className="ml-1 text-red-500 font-bold animate-pulse">!!! CANCELLED !!!</span>}
                        </p>
                        <p className={cn(
                          "text-[9px] uppercase tracking-[0.12em] md:text-[10px]",
                          item.status === 'cancelled' ? "text-slate-400" : "text-slate-500"
                        )}>
                          Qty {item.quantity}
                          {item.seat_no ? ` • Seat ${item.seat_no}` : ""}
                          {item.notes ? ` • ${item.notes}` : ""}
                        </p>
                        {item.status === 'cancelled' && (
                          <div className="mt-1 flex items-center gap-1.5 rounded-sm bg-red-50 px-1.5 py-0.5 border border-red-100/50">
                            <XCircle className="h-2.5 w-2.5 text-red-500" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-red-600">
                              REASON: {item.cancel_reason || 'N/A'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "text-xs font-semibold md:text-sm",
                          item.status === 'cancelled' ? "text-slate-400" : "text-slate-700"
                        )}>
                          {formatCurrency(item.total_price)}
                        </div>
                        
                        {canCancelOrder(liveDetailsOrder).allowed && item.status !== 'cancelled' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCancellingItem({ id: item.id, name: item.name });
                              setCancelReason("");
                            }}
                            disabled={cancelOrderItem.isPending}
                            className="h-6 w-6 rounded-sm text-rose-400 hover:bg-rose-50 hover:text-rose-600 md:h-7 md:w-7"
                          >
                            <XCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {getVisibleItems(liveDetailsOrder).length === 0 && (
                    <div className="rounded-sm border border-dashed border-slate-200 bg-slate-50/50 px-3 py-4 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 md:text-[11px]">
                      No item details available yet
                    </div>
                  )}
                </div>
              </div>

              {liveDetailsOrder.notes && (
                <div className="mt-4 rounded-sm border border-slate-200 bg-slate-50/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:text-[10px]">Order Notes</p>
                  <p className="mt-1 text-xs text-slate-700 md:text-sm">{liveDetailsOrder.notes}</p>
                </div>
              )}

              <div className="mt-4">
                {canCancelOrder(liveDetailsOrder).allowed ? (
                  <div className="space-y-3 rounded-sm border border-rose-200 bg-rose-50/60 p-3 md:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-rose-500 md:h-4 md:w-4" />
                        <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-600 md:text-[11px]">Cancellation Window</p>
                        <p className="mt-0.5 text-xs text-slate-600 md:mt-1">Orders can be cancelled by the waiter within 10 minutes. Managers can cancel anytime before settlement.</p>
                      </div>
                      </div>
                      <Badge className="shrink-0 rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-700 md:px-2.5 md:py-1 md:text-[10px]">
                        {`${getCancelTimeRemaining(liveDetailsOrder).label}`}
                      </Badge>
                    </div>
                    <Textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Reason for cancellation"
                      className="min-h-[80px] border-rose-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-300 focus:ring-0 md:min-h-[92px] md:text-sm"
                    />
                    <Button
                      onClick={submitOrderCancel}
                      disabled={updateOrderStatus.isPending}
                      className="h-9 w-full rounded-sm bg-rose-500 text-[10px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-rose-600 md:h-10 md:text-[11px]"
                    >
                      Cancel Order
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-sm border border-slate-200 bg-slate-50/60 p-3 md:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:text-[11px]">Cancellation Rule</p>
                        <p className="mt-0.5 text-xs text-slate-600 md:mt-1">Waiters: 10-minute window. Managers: Unlimited before settlement.</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 rounded-sm border-slate-200 bg-white text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:text-[10px]">
                        {getCancelTimeRemaining(liveDetailsOrder).remainingMs > 0
                          ? `Time left ${getCancelTimeRemaining(liveDetailsOrder).label}`
                          : "Cancel closed"}
                      </Badge>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 md:px-5 md:py-4">
            <Button
              variant="outline"
              onClick={() => {
                setDetailsOrder(null);
                setCancelReason("");
              }}
              className="h-9 rounded-sm md:h-10"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item Cancellation Reason Dialog */}
      <Dialog open={!!cancellingItem} onOpenChange={(open) => !open && setCancellingItem(null)}>
        <DialogContent className="overflow-hidden rounded-md border border-slate-300 bg-white p-0 shadow-2xl sm:max-w-[400px]" aria-describedby={undefined}>
          <div className="border-b border-slate-200 bg-red-50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base font-semibold uppercase tracking-[0.08em] text-red-900">Cancel Item</DialogTitle>
                <DialogDescription className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-red-600">
                  {cancellingItem?.name}
                </DialogDescription>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-red-200 bg-white">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <div className="space-y-2">
              <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Reason for Cancellation</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g., Guest changed mind, Out of stock, Entry error..."
                className="min-h-[100px] border-slate-200 bg-slate-50 text-xs text-slate-900 focus:border-red-200 focus:ring-0"
              />
            </div>

            <div className="flex gap-3">
              <Button 
                variant="outline"
                onClick={() => setCancellingItem(null)}
                className="h-11 flex-1 rounded-sm text-[11px] font-semibold uppercase tracking-[0.12em]"
              >
                Go Back
              </Button>
              <Button 
                onClick={submitItemCancel}
                disabled={cancelOrderItem.isPending}
                className="h-11 flex-[2] rounded-sm bg-red-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-none hover:bg-red-600"
              >
                {cancelOrderItem.isPending ? "Processing..." : "Confirm Cancel"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {currentKOT && (
        <div className="hidden">
          <KOTPrint 
            data={currentKOT} 
            onComplete={() => setCurrentKOT(null)} 
          />
        </div>
      )}

      {/* Customer Selector Dialog */}
      <HotelCustomerSelectorDialog
        open={showCustomerSelector}
        onOpenChange={setShowCustomerSelector}
        selectedCustomer={selectedCustomer}
        onSelectCustomer={setSelectedCustomer}
      />
      
      {/* Split Bill Dialog */}
      {splitBillOrder && (
        <SplitBillDialog
          open={showSplitBill}
          onOpenChange={(open) => {
            setShowSplitBill(open);
            if (!open) setSplitBillOrder(null);
          }}
          order={{
            ...splitBillOrder,
            items: splitBillOrder.items?.length
              ? splitBillOrder.items
              : (localItemsMap[splitBillOrder.id] ?? []),
          }}
          formatCurrency={formatCurrency}
          activeStaff={activeStaff}
          activeShift={activeShift}
          onComplete={() => {
            toast.success('Split bill completed and settled.');
            setShowSplitBill(false);
            setSplitBillOrder(null);
          }}
        />
      )}
    </div>
  );
});

ActiveOrders.displayName = 'ActiveOrders';
