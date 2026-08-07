import { useState, useMemo, useEffect } from 'react';
import { HotelOrder } from '@/types/hotel';
import { HotelPOSPayment } from '@/hooks/useHotelPOS';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ShoppingBag,
  Phone,
  MapPin,
  Calendar,
  Users,
  Table2,
  CreditCard,
  Loader2,
  ArrowRight,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { getOrderBalanceDue } from '@/lib/hotelReservationUtils';

type PaymentMethodType = "cash" | "card" | "bank_transfer" | "momo";

const PAYMENT_METHOD_OPTIONS: { id: PaymentMethodType; label: string; }[] = [
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "momo", label: "Mobile Money" },
  { id: "bank_transfer", label: "Bank Transfer" },
];

type OrderFilterType = "takeaway" | "delivery" | "reservation";

interface PaymentEntry {
  id: string;
  method: PaymentMethodType;
  amount: number;
}

interface ReservationReadyWaiter {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  shift_id: string;
}

interface PosHandleProps {
  unsettledOrders: HotelOrder[];
  formatCurrency: (v: number) => string;
  completingOrder: HotelOrder | null;
  setCompletingOrder: (order: HotelOrder | null) => void;
  onCompleteOrder: (orderId: string, payments: HotelPOSPayment[]) => void;
  onStartOrder: (order: HotelOrder, waiterId: string) => Promise<void> | void;
  onCancelReservation: (order: HotelOrder) => Promise<void> | void;
  isProcessing: boolean;
}

export default function PosHandle({
  unsettledOrders,
  formatCurrency,
  completingOrder,
  setCompletingOrder,
  onCompleteOrder,
  onStartOrder,
  onCancelReservation,
  isProcessing,
}: PosHandleProps) {
  const [selectedFilter, setSelectedFilter] = useState<OrderFilterType>("takeaway");
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [reservationToCheckIn, setReservationToCheckIn] = useState<HotelOrder | null>(null);
  const [selectedWaiterId, setSelectedWaiterId] = useState<string>("");
  const [isStartingReservation, setIsStartingReservation] = useState(false);
  const [cancellingReservationId, setCancellingReservationId] = useState<string | null>(null);
  const reservationAssignedWaiterId =
    reservationToCheckIn?.assigned_waiter_id || reservationToCheckIn?.waiter_id || null;

  const { data: activeWaiters = [] } = useQuery<ReservationReadyWaiter[]>({
    queryKey: ['pos-handle-ready-waiters'],
    queryFn: async () => {
      const [{ data: waiters, error: waitersError }, { data: openShifts, error: shiftsError }] =
        await Promise.all([
          apiClient
            .from('hotel_staff')
            .select('id, first_name, last_name, role')
            .eq('is_active', true)
            .in('role', ['waiter', 'waiter_admin'])
            .order('first_name', { ascending: true })
            .order('last_name', { ascending: true }),
          apiClient
            .from('hotel_staff_shifts')
            .select('id, staff_id, opened_at')
            .is('closed_at', null)
            .order('opened_at', { ascending: false }),
        ]);

      if (waitersError) throw waitersError;
      if (shiftsError) throw shiftsError;

      const shiftIdByStaffId = new Map<string, string>();
      for (const shift of openShifts || []) {
        if (shift?.staff_id && shift?.id && !shiftIdByStaffId.has(shift.staff_id)) {
          shiftIdByStaffId.set(shift.staff_id, shift.id);
        }
      }

      return (waiters || [])
        .filter((waiter) => shiftIdByStaffId.has(waiter.id))
        .map((waiter) => ({
          ...waiter,
          shift_id: shiftIdByStaffId.get(waiter.id)!,
        }));
    },
    staleTime: 1000 * 60,
  });

  const filteredOrders = useMemo(() => {
    return unsettledOrders.filter((order) => {
      if (order.order_type !== selectedFilter) return false;
      if (selectedFilter === 'reservation' && order.checked_in_at) return false;
      return true;
    });
  }, [unsettledOrders, selectedFilter]);

  const selectedOrder = useMemo(() => {
    if (!completingOrder) return null;
    return (
      unsettledOrders.find((o) => o.id === completingOrder.id) || completingOrder
    );
  }, [completingOrder, unsettledOrders]);

  const hasItems = (order: HotelOrder) => {
    return (order.items?.length ?? 0) > 0;
  };

  const getBalanceDue = (order: HotelOrder) => {
    return getOrderBalanceDue(order);
  };

  const getActionLabel = (order: HotelOrder) => {
    if (order.order_type === "reservation" && !hasItems(order) && !order.checked_in_at) {
      return "Start Order";
    }
    const balanceDue = getBalanceDue(order);
    if (balanceDue <= 0) {
      return "Settle Order";
    }
    return "Collect Payment";
  };

  const handleAction = async (order: HotelOrder) => {
    if (order.order_type === "reservation" && !hasItems(order) && !order.checked_in_at) {
      setReservationToCheckIn(order);
      return;
    }
    
    // For takeaway/delivery/reservation orders that are already paid with zero balance,
    // settle directly without opening the payment dialog
    const isTakeaway = ['takeaway', 'delivery', 'reservation'].includes(order.order_type || '');
    const alreadyPaidTakeaway = isTakeaway && order.status === 'paid' && getBalanceDue(order) <= 0;
    if (alreadyPaidTakeaway) {
      console.log('[PosHandleDialog] Settling already-paid takeaway order directly:', order.id);
      try {
        await onCompleteOrder(order.id, []);
        toast.success('Order settled successfully');
      } catch (error) {
        toast.error('Failed to settle order');
        console.error('[PosHandleDialog] Settle error:', error);
      }
      return;
    }
    
    setCompletingOrder(order);
  };

  // Initialize payments when dialog opens
  useEffect(() => {
    if (completingOrder) {
      const balance = getBalanceDue(completingOrder);
      setPayments([
        { id: crypto.randomUUID(), method: 'cash', amount: balance }
      ]);
    }
  }, [completingOrder]);

  const totalAllocated = useMemo(() => 
    payments.reduce((sum, p) => sum + p.amount, 0),
    [payments]
  );

  const handleAddPayment = () => {
    if (!selectedOrder) return;
    const remaining = Math.max(0, getBalanceDue(selectedOrder) - totalAllocated);
    if (remaining <= 0) return;
    setPayments([...payments, { 
      id: crypto.randomUUID(), 
      method: 'card', 
      amount: remaining 
    }]);
  };

  const handleRemovePayment = (id: string) => {
    if (payments.length <= 1) return;
    setPayments(payments.filter(p => p.id !== id));
  };

  const handleUpdatePayment = (id: string, updates: Partial<PaymentEntry>) => {
    setPayments(payments.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handleCollectPayment = async () => {
    if (!selectedOrder) return;
    const balanceDue = getBalanceDue(selectedOrder);

    if (totalAllocated <= 0) {
      toast.error("Enter a valid amount to collect");
      return;
    }

    if (totalAllocated > balanceDue) {
      toast.error("Amount exceeds balance due");
      return;
    }

    const posPayments: HotelPOSPayment[] = payments.map(p => ({
      method: p.method,
      amount: p.amount
    }));

    await onCompleteOrder(selectedOrder.id, posPayments);
    setCompletingOrder(null);
  };

  const handleClosePaymentDialog = () => {
    setCompletingOrder(null);
    setPayments([]);
  };

  useEffect(() => {
    if (!reservationToCheckIn) {
      setSelectedWaiterId("");
      return;
    }

    const preferredWaiterId =
      [reservationToCheckIn.assigned_waiter_id, reservationToCheckIn.waiter_id]
        .find((waiterId) => !!waiterId && activeWaiters.some((waiter) => waiter.id === waiterId)) ||
      activeWaiters[0]?.id ||
      "";
    setSelectedWaiterId(preferredWaiterId);
  }, [activeWaiters, reservationToCheckIn]);

  const assignedWaiterUnavailable = useMemo(() => {
    if (!reservationAssignedWaiterId) {
      return false;
    }

    return !activeWaiters.some((waiter) => waiter.id === reservationAssignedWaiterId);
  }, [activeWaiters, reservationAssignedWaiterId]);

  const selectedWaiter = useMemo(
    () => activeWaiters.find((waiter) => waiter.id === selectedWaiterId) || null,
    [activeWaiters, selectedWaiterId]
  );

  const reservedWaiterName = useMemo(() => {
    if (reservationToCheckIn?.assigned_waiter) {
      return `${reservationToCheckIn.assigned_waiter.first_name} ${reservationToCheckIn.assigned_waiter.last_name}`;
    }

    if (reservationToCheckIn?.waiter) {
      return `${reservationToCheckIn.waiter.first_name} ${reservationToCheckIn.waiter.last_name}`;
    }

    return 'Not assigned';
  }, [reservationToCheckIn]);

  const isReassigningReservation = useMemo(() => {
    if (!reservationAssignedWaiterId || !selectedWaiterId) {
      return false;
    }

    return reservationAssignedWaiterId !== selectedWaiterId;
  }, [reservationAssignedWaiterId, selectedWaiterId]);

  const handleConfirmStartOrder = async () => {
    if (!reservationToCheckIn) return;
    if (!selectedWaiterId) {
      toast.error('Choose a waiter before starting the reservation');
      return;
    }

    setIsStartingReservation(true);
    try {
      await onStartOrder(reservationToCheckIn, selectedWaiterId);
      setReservationToCheckIn(null);
    } finally {
      setIsStartingReservation(false);
    }
  };

  const handleCancelNoShow = async (order: HotelOrder) => {
    const confirmed = window.confirm(
      `Mark ${order.customer_name || 'this reservation'} as a no-show and release Table ${order.table_number || ''}?`
    );
    if (!confirmed) return;

    setCancellingReservationId(order.id);
    try {
      await onCancelReservation(order);
    } finally {
      setCancellingReservationId(null);
    }
  };

  if (completingOrder) {
    return (
      <div className="flex flex-col h-full border rounded-md border-slate-300 bg-white shadow-xl overflow-hidden">
        <div className="border-b border-slate-300 bg-slate-50 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold uppercase tracking-tight text-slate-900">Collect Payment</h2>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                {selectedOrder?.customer_name || "Unknown"} — Balance due: {formatCurrency(selectedOrder ? getBalanceDue(selectedOrder) : 0)}
              </p>
            </div>
            <Button variant="ghost" onClick={handleClosePaymentDialog}>Cancel</Button>
          </div>
        </div>

        <ScrollArea className="flex-1 overflow-y-auto p-5">
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Payment Breakdown
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddPayment}
                  disabled={!selectedOrder || Math.max(0, getBalanceDue(selectedOrder) - totalAllocated) <= 0}
                  className="h-7 text-[11px] font-bold uppercase text-primary"
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Split
                </Button>
              </div>
              <div className="space-y-3">
                {payments.map((payment) => (
                  <div key={payment.id} className="flex items-start gap-3 p-4 rounded-md border border-slate-200 bg-slate-50/50">
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold uppercase text-slate-500">Method</Label>
                        <Select
                          value={payment.method}
                          onValueChange={(v: PaymentMethodType) => handleUpdatePayment(payment.id, { method: v })}
                        >
                          <SelectTrigger className="h-9 bg-white border-slate-200 text-xs font-semibold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_METHOD_OPTIONS.map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs font-medium">
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold uppercase text-slate-500">Amount</Label>
                        <Input
                          type="number"
                          value={payment.amount}
                          onChange={(e) => handleUpdatePayment(payment.id, { amount: parseFloat(e.target.value) || 0 })}
                          className="h-9 bg-white border-slate-200 text-xs font-semibold"
                        />
                      </div>
                    </div>
                    {payments.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemovePayment(payment.id)}
                        className="h-8 w-8 text-slate-300 hover:text-rose-500 hover:bg-rose-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className={cn(
              "p-4 rounded-md flex items-center justify-between transition-colors",
              totalAllocated < getBalanceDue(selectedOrder) ? "bg-slate-100 border border-slate-200" : "bg-emerald-500 text-white"
            )}>
              <div>
                <p className={cn("text-[10px] font-bold uppercase tracking-[0.14em]", totalAllocated < getBalanceDue(selectedOrder) ? "text-slate-500" : "text-white/80")}>
                  {totalAllocated < getBalanceDue(selectedOrder) ? "Balance Remaining" : "Ready to Settle"}
                </p>
                <p className="text-sm font-bold">
                  {totalAllocated < getBalanceDue(selectedOrder) ? formatCurrency(getBalanceDue(selectedOrder) - totalAllocated) : formatCurrency(totalAllocated)}
                </p>
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-slate-300 bg-slate-50 px-5 py-3">
          <Button
            variant="ghost"
            onClick={handleClosePaymentDialog}
            className="h-10 rounded-sm px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCollectPayment}
            disabled={isProcessing || totalAllocated <= 0 || totalAllocated > getBalanceDue(selectedOrder)}
            className="h-10 gap-2 rounded-sm bg-emerald-600 px-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-none hover:bg-emerald-700"
          >
            {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
            <Send className="h-4 w-4" />
            Collect Payment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-200/70 bg-white px-5 py-3 rounded-t-md">
        {[
          { id: "takeaway", label: "Takeaway", color: "sky" },
          { id: "delivery", label: "Delivery", color: "violet" },
          { id: "reservation", label: "Reservation", color: "amber" },
        ].map((filter) => {
          const count = unsettledOrders.filter((o) => o.order_type === filter.id).length;
          return (
            <Button
              key={filter.id}
              variant="ghost"
              onClick={() => setSelectedFilter(filter.id as OrderFilterType)}
              className={cn(
                "h-9 px-4 rounded-sm text-[11px] font-semibold uppercase tracking-[0.12em]",
                selectedFilter === filter.id
                  ? `bg-${filter.color}-50 text-${filter.color}-700 border border-${filter.color}-200`
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              )}
            >
              {filter.label}
              {count > 0 && (
                <span className={cn(
                  "ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold border",
                  selectedFilter === filter.id
                    ? `bg-white/80 text-${filter.color}-700 border-${filter.color}-200`
                    : "bg-slate-100 text-slate-600 border-slate-200"
                )}>
                  {count}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      <ScrollArea className="h-[500px] rounded-md border border-slate-200/80 bg-white px-4 py-4">
        {filteredOrders.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center text-slate-400">
            <ShoppingBag className="mb-4 h-16 w-16 opacity-20" />
            <p className="text-sm font-medium">No {selectedFilter} orders</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => {
              const balanceDue = getBalanceDue(order);
              const actionLabel = getActionLabel(order);
              const isReservation = order.order_type === "reservation";
              const typeBadgeColor = order.order_type === "takeaway"
                ? "bg-sky-100 text-sky-700 border-sky-200"
                : order.order_type === "delivery"
                  ? "bg-violet-100 text-violet-700 border-violet-200"
                  : "bg-amber-100 text-amber-700 border-amber-200";

              return (
                <div
                  key={order.id}
                  className="rounded-sm border border-slate-200/80 bg-white p-4 shadow-sm transition-all hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn("px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", typeBadgeColor)}
                        >
                          {order.order_type}
                        </Badge>
                        <span className="text-[11px] font-medium text-slate-500">
                          #{order.order_number?.slice(-6) || order.id.slice(-6)}
                        </span>
                        {(order.payment_status === "partial") && (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-bold uppercase bg-amber-100 text-amber-700 border-amber-200">
                            Partial
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-1 text-sm">
                        {(order.customer_name || order.customer_phone) && (
                          <p className="font-medium text-slate-900">
                            {order.customer_name || "Unknown"}
                            {order.customer_phone && (
                              <span className="ml-2 text-xs text-slate-500">• {order.customer_phone}</span>
                            )}
                          </p>
                        )}
                        {order.customer_address && (
                          <p className="flex items-center gap-1.5 text-xs text-slate-500">
                            <MapPin className="h-3 w-3" />
                            {order.customer_address}
                          </p>
                        )}
                      </div>

                      {isReservation && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                          {(order.reservation_date || order.reservation_time) && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {order.reservation_date} {order.reservation_time}
                            </span>
                          )}
                          {order.party_size && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {order.party_size} guests
                            </span>
                          )}
                          {order.table_number && (
                            <span className="flex items-center gap-1">
                              <Table2 className="h-3 w-3" />
                              Table {order.table_number}
                            </span>
                          )}
                          {order.assigned_waiter && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              Waiter {order.assigned_waiter.first_name} {order.assigned_waiter.last_name}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-4 pt-1">
                        <div className="text-sm">
                          <span className="text-slate-500">Total: </span>
                          <span className="font-semibold text-slate-900">{formatCurrency(Number(order.total_amount || 0))}</span>
                        </div>
                        {Number(order.deposit_amount || 0) > 0 && (
                          <div className="text-sm">
                            <span className="text-slate-500">Deposit: </span>
                            <span className="font-semibold text-sky-700">-{formatCurrency(Number(order.deposit_amount || 0))}</span>
                          </div>
                        )}
                        {Number(order.amount_paid || 0) > 0 && (
                          <div className="text-sm">
                            <span className="text-slate-500">Paid: </span>
                            <span className="font-semibold text-emerald-700">{formatCurrency(Number(order.amount_paid || 0))}</span>
                          </div>
                        )}
                        <div className="text-sm">
                          <span className="text-slate-500">Due: </span>
                          <span className="font-semibold text-rose-600">{formatCurrency(balanceDue)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 space-y-2">
                      {actionLabel === "Start Order" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleCancelNoShow(order)}
                            disabled={cancellingReservationId === order.id}
                            className="h-9 w-full gap-1.5 rounded-sm border-rose-200 bg-rose-50 text-[11px] font-semibold uppercase tracking-wider text-rose-700 hover:bg-rose-100"
                          >
                            {cancellingReservationId === order.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            <Trash2 className="h-3.5 w-3.5" />
                            Cancel / No-show
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleAction(order)}
                            className="h-9 w-full gap-1.5 rounded-sm bg-sky-500 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-sky-600"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            {actionLabel}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleAction(order)}
                          className="h-9 gap-1.5 rounded-sm bg-emerald-500 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-emerald-600"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          {actionLabel}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <Dialog open={!!reservationToCheckIn} onOpenChange={(open) => !open && setReservationToCheckIn(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Check In Reservation</DialogTitle>
            <DialogDescription>
              Choose the waiter who will own this table when the reservation is checked in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Customer</span>
                <span className="font-semibold text-slate-900">{reservationToCheckIn?.customer_name || 'Walk-in reservation'}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-500">Party Size</span>
                <span className="font-semibold text-slate-900">{reservationToCheckIn?.party_size || 1}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-500">Table</span>
                <span className="font-semibold text-slate-900">{reservationToCheckIn?.table_number || 'Unassigned'}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-500">Deposit</span>
                <span className="font-semibold text-sky-700">{formatCurrency(Number(reservationToCheckIn?.deposit_amount || 0))}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-500">Reserved Waiter</span>
                <span className="font-semibold text-slate-900">
                  {reservedWaiterName}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Check-In Waiter
              </Label>
              <Select value={selectedWaiterId} onValueChange={setSelectedWaiterId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Choose a waiter" />
                </SelectTrigger>
                <SelectContent>
                  {activeWaiters.map((waiter) => (
                    <SelectItem key={waiter.id} value={waiter.id}>
                      {waiter.first_name} {waiter.last_name} ({waiter.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignedWaiterUnavailable && (
                <p className="text-xs text-amber-700">
                  The originally assigned waiter is not on an open shift right now. Choose another waiter or open that waiter&apos;s shift first.
                </p>
              )}
              {selectedWaiter && !isReassigningReservation && (
                <p className="text-xs text-slate-500">
                  {selectedWaiter.first_name} {selectedWaiter.last_name} will own the live table and any new orders after check-in.
                </p>
              )}
              {selectedWaiter && isReassigningReservation && (
                <p className="text-xs text-amber-700">
                  This check-in will reassign the table from {reservedWaiterName} to {selectedWaiter.first_name} {selectedWaiter.last_name}.
                </p>
              )}
              {activeWaiters.length === 0 && (
                <p className="text-xs text-rose-600">No waiters with an open shift are available right now.</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setReservationToCheckIn(null)} disabled={isStartingReservation}>
              Cancel
            </Button>
            <Button onClick={() => void handleConfirmStartOrder()} disabled={isStartingReservation || !selectedWaiterId}>
              {isStartingReservation && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Check-In
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
