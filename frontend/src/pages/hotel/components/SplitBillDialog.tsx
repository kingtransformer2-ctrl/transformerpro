import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  User, Plus, X, CheckCircle2,
  CreditCard, Banknote, SplitSquareHorizontal,
  UserRound, Smartphone, Wallet, Receipt, AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { memo, useState, useMemo, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { type Customer } from "@/hooks/useCustomers";
import { HotelCustomerSelectorDialog } from "@/components/hotel/HotelCustomerSelectorDialog";
import { HotelReceiptPrint } from "@/components/hotel/HotelReceiptPrint";
import { useHotelInfo } from "@/hooks/useHotel";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { syncService } from "@/lib/syncService";
import { recordHotelInvoicePayment } from "@/hooks/useHotelServices";
import { getLocalData } from "@/lib/localDataService";
import type { HotelTableSessionSeat } from "@/types/hotel";
import {
  useActiveTableSession,
  useOpenHotelTableSession,
  useRecordHotelTablePayment,
  useTableSessionBillingItems,
  useTableSessionSummary,
} from "@/hooks/useHotelTableSessions";
import { useQueryClient } from "@tanstack/react-query";

interface SplitItem {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  seatId?: string | null;
  seatNo?: number | null;
  originalOrderItem: any;
}

interface SplitCustomer {
  id: string;
  name: string;
  customer?: Customer | null;
  seatId?: string | null;
  seatNo?: number | null;
  itemIds: string[];
  paymentMethod: string;
  paymentStatus: 'pending' | 'partial' | 'paid';
  paidAmount: number;
  invoiceId?: string;
  invoiceNumber?: string;
}

interface SplitBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: any;
  formatCurrency: (v: number) => string;
  activeStaff: any;
  activeShift: any;
  onComplete: () => void;
}

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash',  icon: Banknote   },
  { value: 'card',          label: 'Card',  icon: CreditCard },
  { value: 'momo',          label: 'Momo',  icon: Smartphone },
  { value: 'bank_transfer', label: 'Bank',  icon: Receipt    },
];

const makeCustomer = (n: number): SplitCustomer => ({
  id: String(n),
  name: `Customer ${n}`,
  customer: null,
  seatId: null,
  seatNo: n,
  itemIds: [],
  paymentMethod: 'cash',
  paymentStatus: 'pending',
  paidAmount: 0,
});

export const SplitBillDialog = memo(({
  open, onOpenChange, order, formatCurrency, activeStaff, activeShift, onComplete
}: SplitBillDialogProps) => {
  const { data: hotelInfo } = useHotelInfo();
  const { receiptSettings } = useSettingsContext();
  const queryClient = useQueryClient();
  const resolvedStaffId = activeStaff?.staff_id ?? activeStaff?.id ?? null;
  const isTableSplit = !!order?.session_id;
  const initializedRef = useRef(false);

  const { data: activeTableSession } = useActiveTableSession(
    open && order?.table_id ? order.table_id : null,
    open && !!order?.table_id
  );
  const openTableSession = useOpenHotelTableSession();
  const activeSessionId = order?.session_id || activeTableSession?.id || null;
  const { data: sessionSummary, isLoading: isSessionSummaryLoading } = useTableSessionSummary(
    activeSessionId,
    open && !!activeSessionId && isTableSplit,
    { refetchOnMount: open ? 'always' : false }
  );
  const { data: sessionBillingItems = [], isLoading: areSessionItemsLoading } = useTableSessionBillingItems(
    activeSessionId,
    open && !!activeSessionId && isTableSplit,
    { refetchOnMount: open ? 'always' : false }
  );
  const recordTablePayment = useRecordHotelTablePayment();

  const [customers, setCustomers]           = useState<SplitCustomer[]>([makeCustomer(1)]);
  const [items, setItems]                   = useState<SplitItem[]>([]);
    const [localFallbackItems, setLocalFallbackItems] = useState<any[]>([]);
  const [receiptData, setReceiptData]       = useState<any>(null);
  const [showCustomerSelector, setShowCustomerSelector] = useState(false);
  const [selectedCustomerIndex, setSelectedCustomerIndex] = useState<number | null>(null);
  const [processingIds, setProcessingIds]   = useState<Set<string>>(new Set());
  const completingRef = useRef(false);
  const latestSessionIdRef = useRef<string | null>(activeSessionId);
  const assignedSeatIdsRef = useRef<Set<string>>(new Set());

  const currentOrderBillingItems = useMemo(
    () => sessionBillingItems.filter((item: any) => item.order_id === order?.id && item.status !== 'cancelled'),
    [order?.id, sessionBillingItems]
  );
  const sessionSeatSummaryById = useMemo(
    () => new Map((sessionSummary?.seats || []).map((seat: any) => [seat.seat_id, seat])),
    [sessionSummary?.seats]
  );

  const loadSessionSeats = useCallback(async (sessionId: string) => {
    const seats = await getLocalData<HotelTableSessionSeat>('hotel_table_session_seats');
    return (seats || [])
      .filter((seat) => seat.session_id === sessionId)
      .sort((left, right) => left.seat_no - right.seat_no);
  }, []);

  const invalidateSplitQueries = useCallback((sessionId?: string | null) => {
    queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
    queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
    if (sessionId) {
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session', order?.table_id || null] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session-summary', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session-items', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
    }
  }, [order?.table_id, queryClient]);

  const ensureSessionSeats = useCallback(async (targetCustomerCount: number) => {
    if (!isTableSplit || !order?.table_id) return null;
    const session = await openTableSession.mutateAsync({
      tableId: order.table_id,
      guestCount: Math.max(targetCustomerCount, 1),
      openedBy: resolvedStaffId,
      openedShiftId: activeShift?.id || null,
      notes: order?.notes || null,
    });
    if (!order?.session_id) {
      await syncService.performOperation('hotel_orders', 'update', {
        id: order.id,
        session_id: session.id,
        updated_at: new Date().toISOString(),
      });
    }
    const seats = await loadSessionSeats(session.id);
    latestSessionIdRef.current = session.id;
    invalidateSplitQueries(session.id);
    return { sessionId: session.id, seats };
  }, [
    activeShift?.id, invalidateSplitQueries, isTableSplit, loadSessionSeats,
    openTableSession, order?.id, order?.notes, order?.session_id, order?.table_id, resolvedStaffId,
  ]);

  const persistSeatName = useCallback(async (seatId?: string | null, name?: string | null) => {
    if (!seatId) return;
    await syncService.performOperation('hotel_table_session_seats', 'update', {
      id: seatId, guest_name: name || null, updated_at: new Date().toISOString(),
    });
  }, []);

  const persistItemSeatAssignment = useCallback(async (
    itemId: string, seatId?: string | null, seatNo?: number | null
  ) => {
    await syncService.performOperation('hotel_order_items', 'update', {
      id: itemId, seat_id: seatId || null, seat_no: seatNo || null,
      payment_group_id: null, updated_at: new Date().toISOString(),
    });
  }, []);

  const setProcessing = (id: string, val: boolean) =>
    setProcessingIds(prev => { const s = new Set(prev); val ? s.add(id) : s.delete(id); return s; });

 useEffect(() => {
    if (!open) { initializedRef.current = false; setLocalFallbackItems([]); return; }
    latestSessionIdRef.current = activeSessionId || latestSessionIdRef.current;
    setReceiptData(null);
    setProcessingIds(new Set());
    completingRef.current = false;
  }, [activeSessionId, open, order]);
 useEffect(() => {
    assignedSeatIdsRef.current = new Set(
      customers.map(c => c.seatId).filter(Boolean) as string[]
    );
  }, [customers]);

  // Load items from local storage when order.items is empty
  useEffect(() => {
    if (!open || !order?.id) return;
    // Items already available — no need to load from local storage
    if (order.items?.length || currentOrderBillingItems.length) return;

    getLocalData<any>('hotel_order_items').then((allItems) => {
      const filtered = (allItems || []).filter(
        (i: any) => i.order_id === order.id && i.status !== 'cancelled'
      );
      if (filtered.length > 0) {
        setLocalFallbackItems(filtered);
        // Only reset init flag ONCE — guard prevents infinite loop
        if (initializedRef.current) {
          initializedRef.current = false;
        }
      }
    }).catch(() => {});
  // order.items and currentOrderBillingItems deliberately excluded —
  // this effect only needs to run when the dialog opens for a new order
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  useEffect(() => {
    if (!open || initializedRef.current) return;
    if (isTableSplit && activeSessionId && (isSessionSummaryLoading || areSessionItemsLoading)) return;
    if (!order?.items?.length && currentOrderBillingItems.length === 0 && localFallbackItems.length === 0) return;
    // Try to get items from billing items first, then order.items,
  // then fall back to local storage
 const fallbackItems: any[] = [];

  const sourceItems = currentOrderBillingItems.length > 0
    ? currentOrderBillingItems.map((item: any) => ({
        id: item.item_id, name: item.name, quantity: item.quantity,
        unit_price: item.unit_price, total_price: item.total_price,
        seat_id: item.seat_id || null, seat_no: item.seat_no || null,
        tax_amount: 0, item_type: 'food', status: item.status,
      }))
    : (order.items?.length ? order.items : localFallbackItems)
        .filter((item: any) => item.status !== 'cancelled');

    const hydratedItems = sourceItems.map((item: any) => ({
      itemId: item.id, name: item.name, quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price), totalPrice: Number(item.total_price),
      seatId: item.seat_id || null, seatNo: item.seat_no || null, originalOrderItem: item,
    }));
    const nextItems = hydratedItems.filter((item) => {
      if (!item.seatId) return true;
      const seatSummary = sessionSeatSummaryById.get(item.seatId);
      return !seatSummary || seatSummary.payment_status !== 'paid';
    });

    const summarySeats = [...(sessionSummary?.seats || [])].sort((l: any, r: any) => l.seat_no - r.seat_no);
    const activeSummarySeats = summarySeats.filter(
      (seat: any) => seat.payment_status !== 'paid' || Number(seat.outstanding_amount || 0) > 0.01
    );
    const seatTotalsById = new Map<string, number>();
    nextItems.filter((item) => item.seatId).forEach((item) => {
      seatTotalsById.set(item.seatId as string, Number(seatTotalsById.get(item.seatId as string) || 0) + item.totalPrice);
    });
    const usedSeats = activeSummarySeats.filter((seat: any) =>
      seat.guest_name || (seat.payment_status && seat.payment_status !== 'pending') ||
      Number(seat.total_paid || 0) > 0 || seatTotalsById.has(seat.seat_id)
    );

    const persistedCustomers = usedSeats.map((seat: any) => ({
      id: seat.seat_id, name: seat.guest_name || `Customer ${seat.seat_no}`,
      customer: null, seatId: seat.seat_id, seatNo: Number(seat.seat_no),
      itemIds: nextItems.filter((item) => item.seatId === seat.seat_id).map((item) => item.itemId),
      paymentMethod: 'cash',
      paymentStatus: (seat.payment_status || 'pending') as SplitCustomer['paymentStatus'],
      paidAmount: Number(seat.total_paid || 0),
    }));

   const fallbackSeat = activeSummarySeats[0] || summarySeats[0] || null;
    const nextCustomers = persistedCustomers.length > 0
      ? persistedCustomers
      : nextItems.length > 0 ? [{
          ...makeCustomer(1),
          id: fallbackSeat?.seat_id || '1',
          seatId: fallbackSeat?.seat_id || null,
          seatNo: Number(fallbackSeat?.seat_no || 1),
          name: fallbackSeat?.guest_name || 'Customer 1',
          // ── KEY FIX: for takeaway orders (no seats), assign ALL items to Customer 1
         // For takeaway: assign ALL items regardless of seatId
          // For table: assign items matching the fallback seat, or ALL if no seat matches
          itemIds: !isTableSplit
            ? nextItems.map((item) => item.itemId)
            : nextItems
                .filter((item) => fallbackSeat?.seat_id
                  ? item.seatId === fallbackSeat.seat_id
                  : true)
                .map((item) => item.itemId),
          paidAmount: Number(fallbackSeat?.total_paid || 0),
          paymentStatus: (fallbackSeat?.payment_status || 'pending') as SplitCustomer['paymentStatus'],
        }] : [];
    setItems(nextItems);
    setCustomers(nextCustomers);
    initializedRef.current = true;
  }, [
    activeSessionId, areSessionItemsLoading, currentOrderBillingItems,
    isSessionSummaryLoading, isTableSplit, open, order?.items, sessionSeatSummaryById, sessionSummary?.seats,
    localFallbackItems,
  ]);
  const customerTotals = useMemo(() => customers.map(c => {
    let subtotal = 0, taxAmount = 0;
    c.itemIds.forEach(itemId => {
      const item = items.find(i => i.itemId === itemId);
      if (!item) return;
      subtotal += item.totalPrice;
      if (item.originalOrderItem?.tax_amount) taxAmount += Number(item.originalOrderItem.tax_amount);
    });
    const taxRate      = order?.tax_rate ?? hotelInfo?.tax_rate ?? 0;
    const taxInclusive = (order as any)?.tax_inclusive ?? hotelInfo?.tax_inclusive ?? false;
    if (taxAmount === 0 && taxRate > 0) {
      taxAmount = taxInclusive ? subtotal * (taxRate / (100 + taxRate)) : subtotal * (taxRate / 100);
    }
    let total = taxInclusive ? subtotal : subtotal + taxAmount;
    let paidAmount = Number(c.paidAmount || 0);
    let outstandingAmount = Math.max(total - paidAmount, 0);

   
    // truth so the waiter split dialog cannot drift from the backend contract.
    if (isTableSplit && c.seatId) {
      
      // it would double-count or hide payments (this is the bug we found).
      const seatIsSharedWithAnotherCustomer = customers.some(
        (other) => other.id !== c.id && other.seatId === c.seatId
      );

      const seatSummary = sessionSeatSummaryById.get(c.seatId);

      if (seatSummary && !seatIsSharedWithAnotherCustomer) {
        total = Number(seatSummary.item_total || 0);
        paidAmount = Number(seatSummary.total_paid || 0);
        outstandingAmount = Math.max(Number(seatSummary.outstanding_amount || 0), 0);

        if (taxInclusive) {
          taxAmount = Number((total * (taxRate / (100 + taxRate))).toFixed(2));
          subtotal = Number((total - taxAmount).toFixed(2));
        } else {
          subtotal = Number((total / (1 + taxRate / 100)).toFixed(2));
          taxAmount = Number((total - subtotal).toFixed(2));
        }
      }
      
    }

    return { customerId: c.id, subtotal, taxAmount, total, paidAmount, outstandingAmount, taxRate, taxInclusive };
  }), [customers, items, order, hotelInfo, isTableSplit, sessionSeatSummaryById]);

  const isLocked    = (c: SplitCustomer) => c.paymentStatus !== 'pending' || Number(c.paidAmount) > 0;
  const isAssigned  = useCallback((itemId: string) => customers.some(c => c.itemIds.includes(itemId)), [customers]);
  const allAssigned = useMemo(() => items.every(i => isAssigned(i.itemId)), [items, isAssigned]);
  const allPaid     = useMemo(
    () => customers.length > 0 && allAssigned && customers.every(c => c.paymentStatus === 'paid'),
    [allAssigned, customers]
  );

  const addCustomer = async () => {
    if (!isTableSplit) { setCustomers(prev => [...prev, makeCustomer(prev.length + 1)]); return; }
    try {
      const nextCount = customers.length + 1;
      const ensured = await ensureSessionSeats(nextCount);
      const nextSeat = ensured?.seats.find((seat) => !assignedSeatIdsRef.current.has(seat.id));

      if (nextSeat) {
        // Reserve immediately (synchronously) so a second overlapping
        // addCustomer() call can't also grab this same seat before
        // setCustomers below has flushed to state.
        assignedSeatIdsRef.current.add(nextSeat.id);
      }

      setCustomers(prev => [
        ...prev,
        { ...makeCustomer(prev.length + 1), id: nextSeat?.id || String(prev.length + 1),
          seatId: nextSeat?.id || null, seatNo: nextSeat?.seat_no || prev.length + 1,
          name: nextSeat?.guest_name || `Customer ${prev.length + 1}` },
      ]);
    } catch (error: any) { toast.error(error?.message || 'Could not add another split customer'); }
  };
  const removeCustomer = async (id: string) => {
    if (customers.length <= 1) { toast.error('At least one customer required'); return; }
    const rem  = customers.find((c) => c.id === id);
    const rest = customers.filter((c) => c.id !== id);
    const reassignedTarget = rest[0];
    setCustomers(prev => {
      const removed   = prev.find(c => c.id === id);
      const remaining = prev.filter(c => c.id !== id);
      if (removed?.itemIds.length && remaining.length > 0)
        remaining[0] = { ...remaining[0], itemIds: [...remaining[0].itemIds, ...removed.itemIds] };
      return remaining;
    });
    if (!isTableSplit || !rem) return;
    try {
      await persistSeatName(rem.seatId, null);
      if (reassignedTarget?.seatId && rem.itemIds.length > 0) {
        for (const itemId of rem.itemIds)
          await persistItemSeatAssignment(itemId, reassignedTarget.seatId, reassignedTarget.seatNo || null);
      }
      invalidateSplitQueries(activeSessionId);
    } catch (error: any) { toast.error(error?.message || 'Could not remove that split customer'); }
  };

  const handleSelectCustomer = (sel: Customer | null) => {
    if (selectedCustomerIndex === null) return;
    const target = customers[selectedCustomerIndex] || null;
    setCustomers(prev => prev.map((c, i) =>
      i === selectedCustomerIndex ? { ...c, customer: sel, name: sel?.name || c.name } : c
    ));
    if (target?.seatId) {
      void persistSeatName(target.seatId, sel?.name || target.name)
        .then(() => invalidateSplitQueries(activeSessionId))
        .catch((e: any) => toast.error(e?.message || 'Could not save customer details'));
    }
    setShowCustomerSelector(false);
    setSelectedCustomerIndex(null);
  };

  const toggleItem = (customerId: string, itemId: string) => {
    const targetCustomer = customers.find((c) => c.id === customerId);
    if (!targetCustomer || isLocked(targetCustomer)) return;
    const lockedByOther = customers.some(
      (c) => c.id !== customerId && isLocked(c) && c.itemIds.includes(itemId)
    );
    if (lockedByOther) return;
    const isAlreadyMine = targetCustomer.itemIds.includes(itemId);
    const nextSeatId = isAlreadyMine ? null : targetCustomer.seatId || null;
    const nextSeatNo = isAlreadyMine ? null : targetCustomer.seatNo || null;
    setCustomers(prev => prev.map(c => {
      if (isLocked(c)) return c;
      const lbo = prev.some(o => isLocked(o) && o.itemIds.includes(itemId));
      if (lbo) return c;
      if (c.id === customerId)
        return { ...c, itemIds: c.itemIds.includes(itemId) ? c.itemIds.filter(id => id !== itemId) : [...c.itemIds, itemId] };
      return { ...c, itemIds: c.itemIds.filter(id => id !== itemId) };
    }));
    setItems(prev => prev.map((item) =>
      item.itemId === itemId ? { ...item, seatId: nextSeatId, seatNo: nextSeatNo } : item
    ));
    if (isTableSplit) {
      void persistItemSeatAssignment(itemId, nextSeatId, nextSeatNo)
        .then(() => invalidateSplitQueries(activeSessionId))
        .catch((e: any) => toast.error(e?.message || 'Could not save item assignment'));
    }
  };

  useEffect(() => {
    if (!allPaid || completingRef.current) return;
    // Small delay to allow state to settle before auto-completing
    const timer = setTimeout(() => {
      if (completingRef.current) return;
      completingRef.current = true;
      void handleComplete(true);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPaid]);

  const handlePayCustomer = async (customerId: string) => {
  console.log('[TRACE] handlePayCustomer called', { customerId });
  const customer = customers.find(c => c.id === customerId);

  if (!customer) { console.log('[TRACE] STOP: customer not found'); return; }

 if (customer.paymentStatus === "paid") {
    console.log('[TRACE] STOP: already paid');
    toast.info("Already fully paid");
    return;
  }

  if (processingIds.has(customerId)) {
    console.log('[TRACE] STOP: already processing');
    toast.info("Payment is already processing");
    return;
  }

  if (customer.itemIds.length === 0) {
    console.log('[TRACE] STOP: no items assigned');
    toast.error("Assign items first");
    return;
  }
  // SAFETY CHECK: don't let two customers pay against the same seat
  const seatSharedWithAnother = customers.some(
    (other) => other.id !== customer.id && other.seatId && other.seatId === customer.seatId
  );
  if (seatSharedWithAnother) {
    toast.error(
      "This customer isn't linked to their own seat yet. Please remove and re-add this customer, or reopen Split Bill."
    );
    console.log('[TRACE] STOP: seatId collision detected', { customerId, seatId: customer.seatId });
    return;
  }


  const totalData = customerTotals.find(
    t => t.customerId === customerId
  );

  if (!totalData) {
    console.log('[TRACE] STOP: totalData not found', { customerTotals, customerId });
    toast.error("Customer total not found");
    return;
  }

  const outstanding = totalData.outstandingAmount;

  if (outstanding <= 0) {
    console.log('[TRACE] STOP: no outstanding balance', { outstanding });
    toast.error("No outstanding balance");
    return;
  }

  console.log('[TRACE] proceeding, outstanding =', outstanding);
  const amountToPay = Number(outstanding.toFixed(2));

  setProcessing(customerId, true);

  const loadingId = toast.loading(
    `Processing payment for ${customer.name}...`
  );

  try {
    let resolvedSeatId = customer.seatId || null;
    let resolvedSeatNo = customer.seatNo || null;
    let resolvedSessionId =
      latestSessionIdRef.current || activeSessionId;

    // Only open/create a session+seats if we don't already have what we need.
    // Calling ensureSessionSeats when a session/seat already exists re-triggers
    // openTableSession -> tries to (re)insert the table row -> 23505 duplicate
    // key on hotel_tables_table_number_key -> payment silently fails.
    if (isTableSplit && (!resolvedSessionId || !resolvedSeatId)) {
      const ensured = await ensureSessionSeats(
        Math.max(
          customers.length,
          Number(customer.seatNo || 1)
        )
      );

      resolvedSessionId =
        ensured?.sessionId || resolvedSessionId;

      latestSessionIdRef.current = resolvedSessionId;

      if (!resolvedSeatId) {
        const seat = ensured?.seats.find(
          s => s.seat_no === customer.seatNo
        );

        resolvedSeatId = seat?.id || null;
        resolvedSeatNo = seat?.seat_no || null;
      }
    }

    if (resolvedSeatId) {
      await persistSeatName(
        resolvedSeatId,
        customer.customer?.name || customer.name
      );
    }

    const invoiceId =
  customer.invoiceId || crypto.randomUUID();

const invoiceNumber =
  customer.invoiceNumber ||
  `INV-${Date.now()}`;

// These will be resolved in both table and takeaway paths
let resolvedInvoiceId = invoiceId;
let resolvedInvoiceNumber = invoiceNumber;

// TABLE PAYMENT (fall back to session-level if seat not available)
if ( isTableSplit && resolvedSessionId ) {
      await recordTablePayment.mutateAsync({
        sessionId: resolvedSessionId,
        seatId: resolvedSeatId, // may be null — RPC handles session-level payments
        amount: amountToPay,
        paymentMethod: customer.paymentMethod,
        shiftId: activeShift?.id || null,
        staffId: resolvedStaffId,
        receiptNo: invoiceNumber,
        notes: `Split payment - ${customer.name}`,
        idempotencyKey: crypto.randomUUID(),
      });
    }
    // TAKEAWAY PAYMENT
else {
  const allInvoices = await getLocalData<any>('hotel_invoices');
  const existingInvoice = (allInvoices || []).find(
    (inv: any) => inv.order_id === order.id && inv.status !== 'cancelled'
  );

  resolvedInvoiceId = existingInvoice?.id || invoiceId;
resolvedInvoiceNumber = existingInvoice?.invoice_number || invoiceNumber;
  if (existingInvoice) {
    await recordHotelInvoicePayment({
      invoiceId: resolvedInvoiceId,
      paymentMethod: customer.paymentMethod as any,
      amountPaid: amountToPay,
      shiftId: activeShift?.id || null,
      staffId: resolvedStaffId,
      receiptNo: resolvedInvoiceNumber,
      notes: `Split payment - ${customer.name}`,
      idempotencyKey: crypto.randomUUID(),
    });
  } else {
    await syncService.performOperation('hotel_payments', 'insert', {
      id: crypto.randomUUID(),
      order_id: order.id,
      amount: amountToPay,
      payment_method: customer.paymentMethod,
      staff_id: resolvedStaffId,
      shift_id: activeShift?.id || null,
      status: 'posted',
      receipt_no: resolvedInvoiceNumber,
      notes: `Split payment - ${customer.name}`,
      idempotency_key: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    });
  }

   const totalPaidSoFar = Number((Number(order.amount_paid || 0) + amountToPay).toFixed(2));
   const orderGrandTotal = Number(order.total_amount || totalData.total || 0);
   const nextPaymentStatus = totalPaidSoFar >= orderGrandTotal - 0.01 ? 'paid' : 'partial';
   const nextOrderStatus = nextPaymentStatus === 'paid' ? 'paid' : order.status;
   
   await syncService.performOperation('hotel_orders', 'update', {
     id: order.id,
     payment_method: nextPaymentStatus === 'paid' ? 'split' : customer.paymentMethod,
     payment_status: nextPaymentStatus,
     amount_paid: totalPaidSoFar,
     status: nextOrderStatus,
     is_billed: nextPaymentStatus === 'paid',
     payment_received_at: nextPaymentStatus === 'paid' ? new Date().toISOString() : null,
     updated_at: new Date().toISOString(),
   });

}

    const remaining = Math.max(
      outstanding - amountToPay,
      0
    );

    setCustomers(prev =>
      prev.map(c =>
        c.id === customerId
          ? {
              ...c,
              paidAmount:
                Number(c.paidAmount || 0) +
                amountToPay,
              paymentStatus:
                remaining <= 0.01
                  ? "paid"
                  : "partial",
              invoiceId: resolvedInvoiceId,
invoiceNumber: resolvedInvoiceNumber,
              seatId: resolvedSeatId,
              seatNo: resolvedSeatNo,
            }
          : c
      )
    );

    setReceiptData({
      invoiceNumber: resolvedInvoiceNumber,
      subtotal: totalData.subtotal,
      taxAmount: totalData.taxAmount,
      taxRate: totalData.taxRate,
      total: totalData.total,
      paymentMethod: customer.paymentMethod,
      paidAmount: amountToPay,
      customer: customer.customer || {
        name: customer.name,
      },
      hotelInfo,
      booking: order?.booking || null,
      saleDate: new Date(),
      items: customer.itemIds.map(id => {
        const item = items.find(
          i => i.itemId === id
        );

        return {
          service: {
            name: item?.name || "",
          },
          quantity: item?.quantity || 0,
          unit_price: item?.unitPrice || 0,
        };
      }),
    });

    invalidateSplitQueries(resolvedSessionId);

    if (remaining <= 0.01) {
      toast.success(
        `${customer.name} fully paid`
      );
    } else {
      toast.success(
        `Remaining: ${formatCurrency(remaining)}`
      );
    }
  } catch (err: any) {
    console.error(
      "PAYMENT ERROR:",
      err
    );

    toast.error(
      err?.message || "Payment failed"
    );
  } finally {
    toast.dismiss(loadingId);
    setProcessing(customerId, false);
  }
};

  const handleComplete = async (auto = false) => {
    if (!allPaid && !auto) {
      toast.error(`${customers.filter(c => c.paymentStatus !== 'paid').length} customer(s) still unpaid`);
      return;
    }
    try {
      const sessionId = latestSessionIdRef.current || activeSessionId;
      const now = new Date().toISOString();
      
      // Check if this is a takeaway/delivery/reservation order
      const isTakeawayOrder = ['takeaway', 'delivery', 'reservation'].includes(order?.order_type || '');
      
      if (isTableSplit) {
        toast.success('Split bill complete — all assigned seats are fully settled.');
      } else if (!isTakeawayOrder) {
        // Non-table dine-in split payments still need cashier handover.
        await syncService.performOperation('hotel_orders', 'update', {
          id: order.id,
          status: 'pending_handover',
          payment_method: 'split',
          is_billed: true,
          payment_received_at: now,
          updated_at: now,
        });
        toast.success('Split bill complete — order awaiting cashier approval');
      } else {
        // For takeaway/delivery/reservation, mark order as paid and route to POS Handle
        await syncService.performOperation('hotel_orders', 'update', {
          id: order.id,
          status: 'paid',
          is_billed: true,
          payment_method: 'split',
          payment_received_at: now,
          updated_at: now,
        });

        toast.success('Split bill complete — order moved to POS Handle');
      }
      
      invalidateSplitQueries(sessionId);
      onComplete();
      onOpenChange(false);
    } catch (err: any) {
      completingRef.current = false;
      toast.error(`Could not complete order: ${err?.message || 'Unknown error'}`);
    }
  };

  const paidCount = customers.filter(c => c.paymentStatus === 'paid').length;

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/*
          ┌─ DialogContent ──────────────────────────────────────────────────┐
          │  Full-viewport on mobile, near-full on desktop.                  │
          │  Uses flex-col so header + footer are fixed and body scrolls.    │
          └──────────────────────────────────────────────────────────────────┘
        */}
        <DialogContent
          className={cn(
            // Size: fill screen on mobile, constrained on desktop
            "w-screen h-[100dvh] max-w-none rounded-none",
            "sm:w-[96vw] sm:h-[94vh] sm:max-w-6xl sm:rounded-2xl",
            // Layout
            "flex flex-col overflow-hidden p-0 border-none shadow-2xl gap-0"
          )}
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <DialogHeader className="shrink-0 px-5 py-4 border-b bg-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100">
                <SplitSquareHorizontal className="h-5 w-5 text-violet-600" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg font-bold leading-tight">Split Bill</DialogTitle>
                <DialogDescription className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">
                  Order #{order?.order_number} •{' '}
                  {order?.table_number
                    ? `Table ${order.table_number}`
                    : order?.room?.room_number
                      ? `Room ${order.room.room_number}`
                      : 'Takeaway'}
                </DialogDescription>
              </div>
              <Badge className="shrink-0 bg-violet-100 text-violet-700 border-violet-200 text-xs">
                {paidCount}/{customers.length} Paid
              </Badge>
            </div>
          </DialogHeader>

          {/* ── Body ───────────────────────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {/*
              Two-column layout on md+, stacked on mobile with order items
              collapsed above customers.
            */}
            <div className="flex h-full flex-col md:flex-row">

              {/* ── Left: order items panel ─────────────────────────── */}
              <aside className="flex flex-col border-b md:border-b-0 md:border-r md:w-[280px] lg:w-[320px] shrink-0">
                {/* Panel header */}
                <div className="flex shrink-0 items-center justify-between border-b bg-slate-50 px-4 py-3">
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Order Items
                  </Label>
                  <Badge variant="outline" className="text-xs">{items.length} items</Badge>
                </div>

                {/* Warning */}
                {!allAssigned && (
                  <div className="shrink-0 mx-3 mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="text-xs text-amber-700">Assign all items before paying</span>
                  </div>
                )}

                {/* Item list — scrollable, collapses to fixed height on mobile */}
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="space-y-2">
                    {items.map(item => {
                      const owner     = customers.find(c => c.itemIds.includes(item.itemId));
                      const isPaid    = owner?.paymentStatus === 'paid';
                      const isPartial = owner?.paymentStatus === 'partial';
                      return (
                        <div key={item.itemId} className={cn(
                          "rounded-lg border p-3 transition-colors",
                          isPaid    ? "bg-emerald-50 border-emerald-200"
                          : isPartial ? "bg-amber-50 border-amber-200"
                          : owner   ? "bg-violet-50 border-violet-200"
                          : "bg-white border-slate-200"
                        )}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm font-semibold truncate",
                                isPaid ? "text-emerald-700" : isPartial ? "text-amber-700" : "text-slate-900")}>
                                {item.quantity}× {item.name}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500">{formatCurrency(item.totalPrice)}</p>
                            </div>
                            {owner && (
                              <Badge className={cn("shrink-0 text-[10px]",
                                isPaid    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : isPartial ? "bg-amber-100 text-amber-800 border-amber-300"
                                : "bg-violet-100 text-violet-700 border-violet-200")}>
                                {owner.name}{isPaid ? ' ✓' : isPartial ? ' ⋯' : ''}
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </aside>

              {/* ── Right: customers panel ──────────────────────────── */}
              <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
                {/* Panel header */}
                <div className="flex shrink-0 items-center justify-between border-b bg-slate-50 px-4 py-3">
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Customers
                  </Label>
                  <Button type="button" size="sm" onClick={() => void addCustomer()}
                    className="h-8 gap-1.5 bg-violet-500 text-xs hover:bg-violet-600">
                    <Plus className="h-3.5 w-3.5" /> Add Customer
                  </Button>
                </div>

                {/* Customer cards — the only scroll region on this side */}
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="space-y-5">
                    {customers.map((customer, index) => {
                      const td         = customerTotals.find(t => t.customerId === customer.id);
                      const processing = processingIds.has(customer.id);
                      const locked     = isLocked(customer);
                      const hasItems   = customer.itemIds.length > 0;

                      const disabledReason =
                        customer.paymentStatus === 'paid' ? null :
                        processing ? 'Processing...' :
                        !hasItems  ? 'Assign items first' : null;

                      return (
                        <div key={customer.id} className={cn(
                          "rounded-xl border shadow-sm overflow-hidden bg-white",
                          customer.paymentStatus === 'paid'    ? "border-emerald-300"
                          : customer.paymentStatus === 'partial' ? "border-amber-300"
                          : "border-slate-200"
                        )}>
                          {/* Card header */}
                          <div className={cn(
                            "flex items-center justify-between gap-3 border-b px-4 py-3",
                            customer.paymentStatus === 'paid'    ? "bg-emerald-50 border-emerald-100"
                            : customer.paymentStatus === 'partial' ? "bg-amber-50 border-amber-100"
                            : "bg-slate-50 border-slate-100"
                          )}>
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <div className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                customer.paymentStatus === 'paid'    ? "bg-emerald-100 text-emerald-600"
                                : customer.paymentStatus === 'partial' ? "bg-amber-100 text-amber-600"
                                : "bg-violet-100 text-violet-600"
                              )}>
                                {customer.paymentStatus === 'paid'
                                  ? <CheckCircle2 className="h-4.5 w-4.5" />
                                  : <User className="h-4 w-4" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <Input
                                  value={customer.name}
                                  onChange={e => !locked && setCustomers(p => p.map(c =>
                                    c.id === customer.id ? { ...c, name: e.target.value } : c))}
                                  onBlur={() => {
                                    if (!locked && customer.seatId) {
                                      void persistSeatName(customer.seatId, customer.name)
                                        .then(() => invalidateSplitQueries(activeSessionId))
                                        .catch((e: any) => toast.error(e?.message || 'Could not save name'));
                                    }
                                  }}
                                  disabled={locked}
                                  className={cn("h-8 text-sm font-semibold border-slate-200",
                                    locked && "bg-slate-100 cursor-not-allowed")}
                                  placeholder="Customer name"
                                />
                                <div className="mt-1 flex items-center gap-2">
                                  <Button type="button" variant="ghost" size="sm" disabled={locked}
                                    onClick={() => { if (!locked) { setSelectedCustomerIndex(index); setShowCustomerSelector(true); } }}
                                    className="h-6 px-2 text-[10px] text-violet-600 hover:bg-violet-50 hover:text-violet-700">
                                    <UserRound className="mr-1 h-3 w-3" />
                                    {customer.customer ? 'Change' : 'Select Customer'}
                                  </Button>
                                  {customer.customer?.phone && (
                                    <span className="truncate text-[10px] text-slate-400">{customer.customer.phone}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button type="button" variant="ghost" size="sm" disabled={locked}
                              onClick={() => { if (!locked) void removeCustomer(customer.id); }}
                              className="h-8 w-8 shrink-0 p-0 text-rose-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30">
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Card body */}
                          <div className="p-4 space-y-4">
                            {/* Item assignment */}
                            <div>
                              <Label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                Assign Items
                              </Label>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {items.map(item => {
                                  const mine         = customer.itemIds.includes(item.itemId);
                                  const lockedByOther = customers.some(o => isLocked(o) && o.itemIds.includes(item.itemId));
                                  return (
                                    <Button type="button" key={item.itemId}
                                      variant={mine ? "default" : "ghost"} size="sm"
                                      onClick={() => toggleItem(customer.id, item.itemId)}
                                      disabled={locked || lockedByOther}
                                      className={cn(
                                        "h-auto justify-start py-2 px-3 text-left",
                                        mine
                                          ? "bg-violet-500 text-white hover:bg-violet-600"
                                          : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                                        (locked || lockedByOther) && "cursor-not-allowed opacity-50"
                                      )}>
                                      <div className="flex flex-col items-start gap-0.5">
                                        <span className="text-xs font-semibold leading-tight">{item.quantity}× {item.name}</span>
                                        <span className="text-[10px] opacity-75">{formatCurrency(item.totalPrice)}</span>
                                      </div>
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Payment method + amount — side by side */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                  Payment Method
                                </Label>
                                <Select value={customer.paymentMethod} disabled={locked}
                                  onValueChange={v => !locked && setCustomers(p => p.map(c =>
                                    c.id === customer.id ? { ...c, paymentMethod: v } : c))}>
                                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {PAYMENT_METHODS.map(m => (
                                      <SelectItem key={m.value} value={m.value}>
                                        <div className="flex items-center gap-2">
                                          <m.icon className="h-3.5 w-3.5" />
                                          <span>{m.label}</span>
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                  Amount To Pay
                                </Label>
                                <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold tabular-nums text-slate-900">
                                  {formatCurrency(td?.outstandingAmount || 0)}
                                </div>
                              </div>
                            </div>

                            {/* Totals row */}
                            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Subtotal</span>
                                <span className="font-semibold text-slate-800">{formatCurrency(td?.subtotal || 0)}</span>
                              </div>
                              <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Tax</span>
                                <span className="font-semibold text-slate-800">{formatCurrency(td?.taxAmount || 0)}</span>
                              </div>
                              {(td?.paidAmount || 0) > 0 && (
                                <div className="flex justify-between text-xs">
                                  <span className="text-slate-500">Paid so far</span>
                                  <span className="font-semibold text-emerald-600">{formatCurrency(td?.paidAmount || 0)}</span>
                                </div>
                              )}
                              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                                <span className="text-xs text-slate-500">Remaining</span>
                                <span className={cn("text-sm font-bold",
                                  customer.paymentStatus === 'paid' ? "text-emerald-600" : "text-slate-900")}>
                                  {formatCurrency(td?.outstandingAmount || 0)}
                                </span>
                              </div>
                              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                                <span className="text-xs font-bold uppercase text-slate-600">Total</span>
                                <span className={cn("text-base font-black",
                                  customer.paymentStatus === 'paid'    ? "text-emerald-600"
                                  : customer.paymentStatus === 'partial' ? "text-amber-600"
                                  : "text-violet-600")}>
                                  {formatCurrency(td?.total || 0)}
                                </span>
                              </div>
                            </div>

                            {/* Disabled hint */}
                            {disabledReason && customer.paymentStatus !== 'paid' && (
                              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="text-xs text-slate-500">{disabledReason}</span>
                              </div>
                            )}

                            {/* Pay button */}
                            <Button type="button"
                              onClick={() => void handlePayCustomer(customer.id)}
                              disabled={customer.paymentStatus === 'paid' || !!disabledReason}
                              className={cn("w-full h-10 gap-2",
                                customer.paymentStatus === 'paid'
                                  ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                                  : customer.paymentStatus === 'partial'
                                    ? "bg-amber-500 hover:bg-amber-600 text-white"
                                    : disabledReason
                                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                                      : "bg-violet-500 hover:bg-violet-600 text-white"
                              )}>
                              {processing ? (
                                <><span className="animate-spin">⏳</span>Processing...</>
                              ) : customer.paymentStatus === 'paid' ? (
                                <><CheckCircle2 className="h-4 w-4" />Paid Successfully</>
                              ) : customer.paymentStatus === 'partial' ? (
                                <><Banknote className="h-4 w-4" />Pay Remaining Balance</>
                              ) : (
                                <><Banknote className="h-4 w-4" />Record Payment & Print Receipt</>
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Footer ─────────────────────────────────────────────────── */}
          <DialogFooter className="shrink-0 flex-row items-center justify-end gap-3 border-t bg-slate-50 px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-10">
              Cancel
            </Button>
            <Button type="button"
              onClick={() => void handleComplete(false)}
              disabled={!allPaid}
              className="h-10 gap-2 bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
              <CheckCircle2 className="h-4 w-4" />
              {allPaid ? 'Complete Split' : `${paidCount}/${customers.length} Paid`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {receiptData && (
        <HotelReceiptPrint
          key={`${receiptData.invoiceNumber || 'receipt'}-${String(receiptData.saleDate || '')}-${receiptData.total || 0}`}
          {...receiptData}
          onPrintComplete={() => setReceiptData(null)}
        />
      )}

      <HotelCustomerSelectorDialog
        open={showCustomerSelector}
        onOpenChange={o => { setShowCustomerSelector(o); if (!o) setSelectedCustomerIndex(null); }}
        selectedCustomer={selectedCustomerIndex !== null ? customers[selectedCustomerIndex]?.customer : null}
        onSelectCustomer={handleSelectCustomer}
      />
    </>
  );
});

SplitBillDialog.displayName = 'SplitBillDialog';
