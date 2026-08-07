import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, safeApiClientCall, getIsBackendReachable, canUseRealtime, resetRealtimeReachable, setRealtimeUnreachable } from '@/integrations/supabase/client';
import { syncService } from '@/lib/syncService';
import { toast } from 'sonner';
import { useEffect, useMemo } from 'react';
import { logShiftAction, recordShiftTransaction } from '@/hooks/useHotelShifts';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { HotelOrder, HotelOrderItem, HotelTable, HotelTableSession, OrderStatus } from '@/types/hotel';
import { resolveServiceCategoryStation, inferServiceCategoryStation, normalizeServiceCategoryName, type ServiceStation } from '@/lib/serviceCategoryUtils';
import { recordHotelInvoicePayment, printReceipt, recalculateInvoiceTotals } from '@/hooks/useHotelServices';
import type { HotelPOSPayment } from '@/hooks/useHotelPOS';
import {
  applyOrderQueryScope,
  canAccessHotelOrder,
  canManageHotelOrder,
  filterOrdersForStaff,
  getStoredActiveStaff,
  isCashierStaff,
  isManagerLikeStaff,
  isTableOccupyingOrderStatus,
  isUncheckedInReservationOrder,
  isWaiterStaff,
  normalizeStaffRole,
  TABLE_OCCUPYING_ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES as HOTEL_ACCESS_ACTIVE_ORDER_STATUSES,
} from '@/lib/hotelAccess';
import {
  deductLocalInventoryForOrderItem,
  restoreLocalInventoryForOrderItem
} from '@/lib/hotelInventory';
import { getOrderBalanceDue, getReservationDepositCredit } from '@/lib/hotelReservationUtils';

const HOTEL_ORDER_SYNC_DEBOUNCE_MS = 250;
let hotelOrderSyncTimer: ReturnType<typeof setTimeout> | null = null;
let hotelOrderSyncForce = false;
const ENABLE_REALTIME_DEBUG =
  import.meta.env.DEV && import.meta.env.VITE_DEBUG_REALTIME === 'true';

function logRealtimeDebug(...args: unknown[]) {
  if (ENABLE_REALTIME_DEBUG) {
    console.debug(...args);
  }
}

function scheduleHotelOrderSync(force: boolean = false) {
  if (!navigator.onLine || !getIsBackendReachable()) {
    return;
  }

  hotelOrderSyncForce = hotelOrderSyncForce || force;

  if (hotelOrderSyncTimer) {
    clearTimeout(hotelOrderSyncTimer);
  }

  hotelOrderSyncTimer = setTimeout(() => {
    const nextForce = hotelOrderSyncForce;
    hotelOrderSyncForce = false;
    hotelOrderSyncTimer = null;

    Promise.resolve(null).catch(() => {});
    Promise.resolve(null).catch(() => {});
    Promise.resolve(null).catch(() => {});
    Promise.resolve(null).catch(() => {});
  }, HOTEL_ORDER_SYNC_DEBOUNCE_MS);
}



function applyOrderFilters(orders: HotelOrder[], filters?: { waiterId?: string; status?: string[] }) {
  let filtered = orders;
  if (filters?.waiterId) {
    filtered = filtered.filter(o =>
      o.waiter_id === filters.waiterId ||
      o.staff_id === filters.waiterId ||
      o.assigned_waiter_id === filters.waiterId
    );
  }
  if (filters?.status && filters.status.length > 0) {
    filtered = filtered.filter(o => filters.status?.includes(o.status));
  }
  return filtered;
}

function canMutateOrderForRole(order: Pick<HotelOrder, 'status' | 'waiter_id' | 'staff_id'>, station?: 'kitchen' | 'bar') {
  const activeStaff = getStoredActiveStaff();
  const role = normalizeStaffRole(activeStaff?.role);

  if (canManageHotelOrder(activeStaff, order)) {
    return true;
  }

  if (station === 'kitchen' && role === 'chef') {
    return true;
  }

  if (station === 'bar' && (role === 'barman' || role === 'barista')) {
    return true;
  }

  return false;
}

function mergeOrders(localOrders: HotelOrder[], remoteOrders: HotelOrder[]) {
  const merged = new Map<string, HotelOrder>();

  for (const order of localOrders) {
    merged.set(order.id, order);
  }

  for (const order of remoteOrders) {
    const existing = merged.get(order.id);
    if (!existing) {
      merged.set(order.id, order);
      continue;
    }

    const existingUpdated = new Date(existing.updated_at || existing.created_at).getTime();
    const remoteUpdated = new Date(order.updated_at || order.created_at).getTime();
    merged.set(order.id, remoteUpdated >= existingUpdated ? order : existing);
  }

  return Array.from(merged.values());
}

function toTableOccupancyOrder(order: Partial<HotelOrder>) {
  return {
    id: order.id || '',
    order_number: order.order_number || '',
    table_id: order.table_id || null,
    table_number: order.table_number || null,
    session_id: order.session_id || null,
    seat_id: order.seat_id || null,
    waiter_id: order.waiter_id || null,
    staff_id: order.staff_id || null,
    assigned_waiter_id: order.assigned_waiter_id || null,
    waiter: order.waiter || order.assigned_waiter || null,
    assigned_waiter: order.assigned_waiter || null,
    order_type: order.order_type || 'dine_in',
    checked_in_at: order.checked_in_at || null,
    status: (order.status || 'pending') as OrderStatus,
    created_at: order.created_at || new Date(0).toISOString(),
    updated_at: order.updated_at || order.created_at || new Date(0).toISOString(),
  } as HotelOrder;
}

function toTableOccupancySession(
  session: Partial<HotelTableSession> & { opener?: HotelOrder['waiter'] | null }
) {
  return {
    id: `session-${session.id || ''}`,
    order_number: `SESSION-${String(session.id || '').slice(-4)}`,
    table_id: session.table_id || null,
    table_number: session.table_number || null,
    session_id: session.id || null,
    seat_id: null,
    waiter_id: session.opened_by || null,
    staff_id: session.opened_by || null,
    waiter: session.opener || null,
    status: 'served' as OrderStatus,
    created_at: session.opened_at || session.created_at || new Date(0).toISOString(),
    updated_at: session.updated_at || session.opened_at || session.created_at || new Date(0).toISOString(),
  } as HotelOrder;
}

function mergeTableOccupancyOrders(localOrders: HotelOrder[], remoteOrders: HotelOrder[]) {
  const merged = new Map<string, HotelOrder>();

  for (const order of localOrders) {
    merged.set(order.id, order);
  }

  for (const order of remoteOrders) {
    const existing = merged.get(order.id);
    if (!existing) {
      merged.set(order.id, order);
      continue;
    }

    const existingUpdated = new Date(existing.updated_at || existing.created_at).getTime();
    const remoteUpdated = new Date(order.updated_at || order.created_at).getTime();
    merged.set(order.id, remoteUpdated >= existingUpdated ? order : existing);
  }

  return Array.from(merged.values());
}

function hydrateOrdersWithLocalItems(orders: HotelOrder[], items: HotelOrderItem[]) {
  if (!orders.length || !items.length) {
    return orders;
  }

  const itemsByOrderId = new Map<string, HotelOrderItem[]>();
  for (const item of items) {
    const bucket = itemsByOrderId.get(item.order_id) || [];
    bucket.push(item);
    itemsByOrderId.set(item.order_id, bucket);
  }

  return orders.map((order) => {
    const localItems = itemsByOrderId.get(order.id);
    if (!localItems?.length) {
      return order;
    }

    if (order.items?.length && order.items.length >= localItems.length) {
      return order;
    }

    return {
      ...order,
      items: localItems,
    };
  });
}

function hydrateOrdersWithLocalSessions(orders: HotelOrder[], sessions: HotelTableSession[], seats: HotelTableSessionSeat[]) {
  if (!orders.length || !sessions.length) {
    return orders;
  }

  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const seatsBySessionId = new Map<string, HotelTableSessionSeat[]>();
  for (const seat of seats) {
    const bucket = seatsBySessionId.get(seat.session_id) || [];
    bucket.push(seat);
    seatsBySessionId.set(seat.session_id, bucket);
  }

  return orders.map((order) => {
    if (!order.session_id) {
      return order;
    }

    const session = sessionById.get(order.session_id);
    if (!session) {
      return order;
    }

    const sessionSeats = seatsBySessionId.get(session.id) || [];
    return {
      ...order,
      session: {
        ...session,
        seats: sessionSeats.sort((a, b) => a.seat_no - b.seat_no),
      },
    };
  });
}

function sortOrdersNewestFirst<T extends Pick<HotelOrder, 'created_at'>>(orders: T[]) {
  return [...orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function getActiveOrderItems(items?: HotelOrderItem[]) {
  return (items || []).filter((item) => item.status !== 'cancelled');
}

function recalculateOrderTotalsFromActiveItems(order: HotelOrder) {
  const activeItems = getActiveOrderItems(order.items);
  
  // ✅ KEY FIX: If no items are attached yet, preserve the stored totals.
  // Items may not be hydrated yet (race condition on first load).
  if (!order.items || order.items.length === 0) {
    return order;
  }
  
  const subtotal = activeItems.reduce(
    (sum, item) => sum + Number(item.total_price || 0),
    0
  );
  const recalculated = calculateOrderTotalsFromSubtotal(order, subtotal);
  return { ...order, ...recalculated };
}

function recalculateAllOrderTotals(orders: HotelOrder[]) {
  return orders.map(recalculateOrderTotalsFromActiveItems);
}

function inferOrderTaxProfile(order: Pick<HotelOrder, 'subtotal' | 'discount_amount' | 'tax_amount' | 'total_amount'>) {
  const subtotal = Number(order.subtotal || 0);
  const discountAmount = Number(order.discount_amount || 0);
  const taxAmount = Number(order.tax_amount || 0);
  const totalAmount = Number(order.total_amount || 0);
  const discountedSubtotal = Number(Math.max(0, subtotal - discountAmount).toFixed(2));
  const taxInclusive = Math.abs(totalAmount - discountedSubtotal) < 0.02;

  let taxRate = 0;
  if (taxInclusive) {
    const untaxedAmount = Math.max(0, totalAmount - taxAmount);
    taxRate = untaxedAmount > 0 ? Number(((taxAmount / untaxedAmount) * 100).toFixed(4)) : 0;
  } else {
    taxRate = discountedSubtotal > 0 ? Number(((taxAmount / discountedSubtotal) * 100).toFixed(4)) : 0;
  }

  return {
    taxInclusive,
    taxRate,
    discountAmount,
  };
}

function calculateOrderTotalsFromSubtotal(
  order: Pick<HotelOrder, 'subtotal' | 'discount_amount' | 'tax_amount' | 'total_amount'>,
  subtotal: number
) {
  const safeSubtotal = Number(Math.max(0, subtotal).toFixed(2));
  const { taxInclusive, taxRate, discountAmount } = inferOrderTaxProfile(order);

  if (taxInclusive) {
    const totalAmount = Number(Math.max(0, safeSubtotal - discountAmount).toFixed(2));
    const taxAmount = Number((totalAmount * (taxRate / (100 + taxRate))).toFixed(2));
    return {
      subtotal: safeSubtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
    };
  }

  const taxableAmount = Number(Math.max(0, safeSubtotal - discountAmount).toFixed(2));
  const taxAmount = Number((taxableAmount * (taxRate / 100)).toFixed(2));
  const totalAmount = Number((taxableAmount + taxAmount).toFixed(2));

  return {
    subtotal: safeSubtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
  };
}

function normalizeTableNumber(tableNumber?: string | null) {
  return (tableNumber || '').trim().toUpperCase();
}

// Use the constant from hotelAccess.ts instead of local duplicate
// const TABLE_OCCUPYING_ORDER_STATUSES: OrderStatus[] = ['pending', 'preparing', 'ready', 'served', 'billed'];

export async function setHotelTableStatus(
  tableId: string | null | undefined, 
  tableNumber: string | null | undefined, 
  status: HotelTableStatus,
  queryClient?: any // Allow passing queryClient for instant invalidation
) {
  console.log('[setHotelTableStatus] START:', {
    tableId,
    tableNumber,
    status
  });
  
  const normalizedTableNumber = normalizeTableNumber(tableNumber);
  const cleaningStartedAt = status === 'cleaning' ? new Date().toISOString() : null;

  // 1. Try to find the table locally first
  console.log('[setHotelTableStatus] Fetching local tables...');
  const localTables = await apiClient.from('hotel_tables').select('*').then(res => res.data || []);
  const table = tableId 
    ? localTables.find(t => t.id === tableId)
    : localTables.find(t => normalizeTableNumber(t.table_number) === normalizedTableNumber);

  console.log('[setHotelTableStatus] Found table:', table);

  if (table) {
    const nextCleaningStartedAt =
      status === 'cleaning'
        ? table.cleaning_started_at || cleaningStartedAt
        : null;

    if (table.status === status && table.cleaning_started_at === nextCleaningStartedAt) {
      console.log('[setHotelTableStatus] Table status already correct, no update needed');
      return;
    }
    
    // 2. Update via syncService for sanitization and offline support
    console.log('[setHotelTableStatus] Updating via syncService:', {
      id: table.id,
      status,
      cleaning_started_at: nextCleaningStartedAt
    });
    await syncService.performOperation('hotel_tables', 'update', {
      id: table.id,
      status,
      cleaning_started_at: nextCleaningStartedAt,
      updated_at: new Date().toISOString()
    });
    console.log('[setHotelTableStatus] Table updated successfully via syncService');

    // 3. Invalidate cache RIGHT AWAY if queryClient is provided
    if (queryClient) {
      console.log('[setHotelTableStatus] Invalidating queries...');
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session-summary'] });
    }
    console.log('[setHotelTableStatus] END (local table found)');
    return;
  }

  // 4. Fallback to Supabase if not found locally (unlikely but safe)
  if (navigator.onLine) {
    console.log('[setHotelTableStatus] Falling back to remote table lookup...');
    let query = apiClient
      .from('hotel_tables')
      .select('id, status')
      .eq('is_active', true);

    if (tableId) {
      query = query.eq('id', tableId);
    } else if (normalizedTableNumber) {
      query = query.eq('table_number', normalizedTableNumber);
    } else {
      console.log('[setHotelTableStatus] No tableId or normalizedTableNumber provided');
      return;
    }

    const { data: remoteTable } = await query.maybeSingle();

    console.log('[setHotelTableStatus] Found remote table:', remoteTable);

    if (remoteTable && remoteTable.status !== status) {
      console.log('[setHotelTableStatus] Updating remote table via syncService...');
      await syncService.performOperation('hotel_tables', 'update', {
        id: remoteTable.id,
        status,
        cleaning_started_at: cleaningStartedAt,
        updated_at: new Date().toISOString()
      });
      console.log('[setHotelTableStatus] Remote table updated successfully');

      if (queryClient) {
        console.log('[setHotelTableStatus] Invalidating queries...');
        queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-table-session'] });
        queryClient.invalidateQueries({ queryKey: ['hotel-table-session-summary'] });
      }
    }
  }
  
  console.log('[setHotelTableStatus] END');
}

export async function releaseHotelTableIfNoActiveOrders(
  tableId: string | null | undefined,
  tableNumber: string | null | undefined,
  excludeOrderId?: string,
  nextStatus: HotelTableStatus = 'free',
  queryClient?: any // Allow passing queryClient for instant invalidation
) {
  const normalizedTableNumber = normalizeTableNumber(tableNumber);

  // 1. Stop early if the table still has any active orders besides the one
  // currently being settled/cancelled. Freeing the table too early makes the
  // dine-in flow feel random because later actions target a stale session.
  const { data: localOrders } = await apiClient
    .from('hotel_orders')
    .select('id, status, table_id, table_number');

  const hasRemainingActiveOrders = (localOrders || []).some((order) => {
    if (excludeOrderId && order.id === excludeOrderId) {
      return false;
    }

    const matchesTable = tableId
      ? order.table_id === tableId
      : normalizeTableNumber(order.table_number) === normalizedTableNumber;

    return matchesTable && TABLE_OCCUPYING_ORDER_STATUSES.includes(order.status as OrderStatus);
  });

  if (hasRemainingActiveOrders) {
    return;
  }

  // 2. Get all related active table sessions
  const { data: localSessions } = await apiClient.from('hotel_table_sessions').select('*');
  const tableSessions = (localSessions || []).filter((session) =>
    (tableId ? session.table_id === tableId : normalizeTableNumber(session.table_number) === normalizedTableNumber)
  );

  // 3. Mark all related active table sessions as completed once no active orders remain.
  for (const session of tableSessions) {
    if (!['completed', 'paid', 'closed'].includes(session.status)) {
      await apiClient.from('hotel_table_sessions').update({
        status: 'completed',
        updated_at: new Date().toISOString()
      }).eq('id', session.id);
    }
  }

  // 4. Only now is it safe to release the table.
  await setHotelTableStatus(tableId, normalizedTableNumber, nextStatus, queryClient);
}

export function useRequestOrderVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    onMutate: async ({ orderId, paymentMethod, staffId, shiftId, customerData }) => {
      await queryClient.cancelQueries({ queryKey: ['hotel-orders'] });
      
      const previousOrders = queryClient.getQueriesData({ queryKey: ['hotel-orders'] });
      const optimisticTimestamp = new Date().toISOString();
      
      queryClient.setQueriesData({ queryKey: ['hotel-orders'] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((order: any) => {
          if (order.id === orderId) {
            // If it's takeaway/delivery/reservation, don't change status to pending_handover
            const isTakeawayType = ['takeaway', 'delivery', 'reservation'].includes(order.order_type || '');
            return {
              ...order,
              status: isTakeawayType ? order.status : 'pending_handover',
              payment_method: paymentMethod,
              payment_received_at: optimisticTimestamp,
              staff_id: staffId,
              shift_id: shiftId,
              customer_id: customerData?.id,
              customer_name: customerData?.name,
              customer_phone: customerData?.phone,
              customer_email: customerData?.email,
              customer_address: customerData?.address,
              customer_tin: customerData?.tin_number,
              updated_at: optimisticTimestamp
            };
          }
          return order;
        });
      });
      
      return { previousOrders };
    },
   
    mutationFn: async ({ 
      orderId, 
      paymentMethod,
      staffId,
      shiftId,
      customerData
    }: { 
      orderId: string; 
      paymentMethod: string;
      staffId: string;
      shiftId: string | null;
      customerData?: {
        id?: string;
        name?: string;
        phone?: string;
        email?: string;
        address?: string;
        tin_number?: string;
      };
    }) => {
      let { data: currentOrder } = await apiClient.from('hotel_orders').select('*').eq('id', orderId).single();
      const sessionStaff = getStoredActiveStaff();

      if (!currentOrder || !canManageHotelOrder(sessionStaff, currentOrder)) {
        throw new Error('You can only hand over your own orders');
      }

      // Check if it's a takeaway/delivery/reservation order — don't allow handover
      const isTakeawayType = ['takeaway', 'delivery', 'reservation'].includes(currentOrder.order_type || '');
      if (isTakeawayType) {
        throw new Error('Takeaway, delivery, and reservation orders must be handled via POS Handle, not waiter handoff');
      }

      const updateData = { 
        id: orderId,
        status: 'pending_handover',
        payment_method: paymentMethod,
        payment_received_at: new Date().toISOString(),
        staff_id: staffId,
        shift_id: shiftId,
        customer_id: customerData?.id,
        customer_name: customerData?.name,
        customer_phone: customerData?.phone,
        customer_email: customerData?.email,
        customer_address: customerData?.address,
        customer_tin: customerData?.tin_number,
        updated_at: new Date().toISOString()
      };

      // Update the order first so the UI reflects the handover immediately.
      await apiClient.from('hotel_orders').update(updateData).eq('id', updateData.id || updateData?.id);

      const followUpTasks: Promise<unknown>[] = [
        releaseHotelTableIfNoActiveOrders(currentOrder.table_id, currentOrder.table_number, orderId),
      ];

      // Record waiter accountability without blocking on separate network round trips.
      if (shiftId) {
        followUpTasks.push(
          recordShiftTransaction({
            shiftId,
            staffId,
            type: paymentMethod as any,
            amount: Number(currentOrder.total_amount),
            referenceId: orderId,
          })
        );

        followUpTasks.push(
          logShiftAction({
            shiftId,
            staffId,
            actionType: 'verification_requested',
            description: `Waiter collected ${paymentMethod} and requested verification for order #${currentOrder.order_number}`,
            referenceId: orderId,
          })
        );
      }

      await Promise.all(followUpTasks);
    },
   onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      scheduleHotelOrderSync(true);
      toast.success('Collection submitted for APPROVAL (Saved locally)');
    },
    onError: (error: Error, _variables: any, context: any) => {
      if (context?.previousOrders) {
        context.previousOrders.forEach(([queryKey, oldData]: [any, any]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
      toast.error(`Request failed: ${error.message}`);
    },
  });
}

export function useApproveAndSettleOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    onMutate: async ({ orderId, cashierId, payments }) => {
      await queryClient.cancelQueries({ queryKey: ['hotel-orders'] });
      
      const previousOrders = queryClient.getQueriesData({ queryKey: ['hotel-orders'] });
      const optimisticTimestamp = new Date().toISOString();
      const paymentMethod =
        payments.length > 1 ? 'split' : (payments[0]?.method || null);
      
      queryClient.setQueriesData({ queryKey: ['hotel-orders'] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((order: any) => {
          if (order.id === orderId) {
            return {
              ...order,
              status: 'settled',
              is_billed: true,
              payment_status: 'paid',
              amount_paid: Number(order.total_amount || 0),
              payment_method: paymentMethod,
              settled_at: optimisticTimestamp,
              settled_by: cashierId,
              updated_at: optimisticTimestamp
            };
          }
          return order;
        });
      });
      
      return { previousOrders };
    },
    mutationFn: async ({
      orderId,
      cashierId,
      shiftId,
      payments,
    }: { 
      orderId: string; 
      cashierId: string;
      shiftId: string | null;
      payments: HotelPOSPayment[];
    }) => {
      // 1. Fetch full order details including items (try local first)
      const { data: orderData } = await apiClient.from('hotel_orders').select('*').eq('id', orderId).single();
      let order = orderData || null;
      
      if (!order && navigator.onLine) {
        const { data: remoteOrder } = await apiClient
          .from('hotel_orders')
          .select(`
            *,
            items:hotel_order_items(*),
            booking:hotel_bookings(id, guest_id)
          `)
          .eq('id', orderId)
          .single();
        if (remoteOrder) order = remoteOrder as HotelOrder;
      }

      if (!order) throw new Error('Order not found');

      let items = Array.isArray((order as any).items) ? (order as any).items : [];
      if (items.length === 0) {
        const { data: localItems } = await apiClient.from('hotel_order_items').select('*').eq('order_id', orderId);
        items = localItems || [];
      }

      if (items.length === 0 && navigator.onLine) {
        const { data: remoteItems, error: remoteItemsError } = await apiClient
          .from('hotel_order_items')
          .select('*')
          .eq('order_id', orderId);

        if (remoteItemsError) {
          throw remoteItemsError;
        }

        items = remoteItems || [];
      }

      if (items.length === 0) {
        throw new Error('Cannot settle this order because no order items were found');
      }

      const balanceDue = getOrderBalanceDue(order);
      const normalizedPayments = (payments || [])
        .map((payment) => ({
          method: payment.method,
          amount: Number(payment.amount || 0),
        }))
        .filter((payment) => payment.amount > 0);

      const fallbackMethod = (order.payment_method || 'cash') as HotelPOSPayment['method'];
      const effectivePayments =
        normalizedPayments.length > 0
          ? normalizedPayments
          : [{ method: fallbackMethod, amount: balanceDue > 0 ? balanceDue : Number(order.total_amount || 0) }];

      const paymentTotal = Number(
        effectivePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0).toFixed(2)
      );
      const totalAmount = Number(order.total_amount || 0);
      const currentAmountPaid = Number(order.amount_paid || 0);
      const depositCredit = getReservationDepositCredit(order);
      const nextAmountPaid = Number((currentAmountPaid + paymentTotal).toFixed(2));
      const effectivePaid = Number((nextAmountPaid + depositCredit).toFixed(2));

      if (Math.abs(paymentTotal - balanceDue) > 0.01) {
        throw new Error(`Settlement must match the balance due of ${balanceDue.toFixed(2)}`);
      }

      if (effectivePaid + 0.01 < totalAmount) {
        throw new Error('Payment allocation does not fully settle this order');
      }

      const paymentMethodSummary =
        effectivePayments.length > 1
          ? 'split'
          : (effectivePayments[0]?.method || fallbackMethod);

      // Step 1: Update order to settled
      await apiClient.from('hotel_orders').update({
        status: 'settled',
        is_billed: true,
        payment_status: 'paid',
        amount_paid: nextAmountPaid,
        payment_method: paymentMethodSummary,
        settled_at: new Date().toISOString(),
        settled_by: cashierId,
        updated_at: new Date().toISOString()
      }).eq('id', orderId);

      // Step 2: Create or reuse invoice
      let invoiceId = order.invoice_id || crypto.randomUUID();
      let invoiceNumber = `INV-SET-${Math.floor(Math.random() * 1000000)}`;

      if (order.invoice_id) {
        const { data: existingInvoice } = await apiClient
          .from('hotel_invoices')
          .select('*')
          .eq('id', order.invoice_id)
          .maybeSingle();

        if (existingInvoice) {
          invoiceId = existingInvoice.id;
          invoiceNumber = existingInvoice.invoice_number;
        }
      }

      if (!order.invoice_id) {
        const initialInvoicePaymentMethod =
          normalizedPayments.length > 1
            ? 'split'
            : (normalizedPayments[0]?.method || fallbackPaymentMethod || null);
        const invoiceData = {
          id: invoiceId,
          invoice_number: invoiceNumber,
          booking_id: order.booking_id || null,
          guest_id: (order as any).booking?.guest_id || null,
          customer_id: order.customer_id || null,
          customer_name: order.customer_name || null,
          customer_phone: order.customer_phone || null,
          customer_email: order.customer_email || null,
          customer_address: order.customer_address || null,
          customer_tin: order.customer_tin || null,
          shift_id: shiftId,
          staff_id: cashierId,
          subtotal: Number(order.subtotal),
          tax_amount: Number(order.tax_amount),
          discount_amount: Number(order.discount_amount || 0),
          total_amount: totalAmount,
          payment_method: paymentMethodSummary,
          payment_status: 'paid',
          notes: 'Settled via billing handoff',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        await apiClient.from('hotel_invoices').insert(invoiceData);

        for (const item of items) {
          const invoiceItem = {
            id: crypto.randomUUID(),
            invoice_id: invoiceId,
            description: item.name,
            item_type: 'order',
            unit_price: item.unit_price,
            quantity: item.quantity,
            total_price: item.total_price,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          await apiClient.from('hotel_invoice_items').insert(invoiceItem);
        }

        await apiClient.from('hotel_orders').update({
          invoice_id: invoiceId,
          updated_at: new Date().toISOString()
        }).eq('id', orderId);
      }

      for (const payment of effectivePayments) {
        await recordHotelInvoicePayment({
          invoiceId,
          paymentMethod: payment.method as any,
          amountPaid: Number(payment.amount || 0),
          shiftId,
          staffId: cashierId || null,
          sessionId: order.session_id || null,
          receiptNo: invoiceNumber,
          notes: 'Payment settled via handover',
        });
      }

      if (order.session_id) {
        const { data: sessionOrders } = await apiClient
          .from('hotel_orders')
          .select('id, status, payment_status')
          .eq('session_id', order.session_id);

        const hasOutstandingSessionOrders = (sessionOrders || []).some((sessionOrder: any) => {
          if (sessionOrder.id === orderId) {
            return false;
          }

          return !['settled', 'paid', 'cancelled'].includes(String(sessionOrder.status || '').toLowerCase()) ||
            String(sessionOrder.payment_status || '').toLowerCase() !== 'paid';
        });

        await apiClient
          .from('hotel_table_sessions')
          .update({
            payment_status: hasOutstandingSessionOrders ? 'partial' : 'paid',
            status: hasOutstandingSessionOrders ? 'active' : 'closed',
            closed_at: hasOutstandingSessionOrders ? null : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.session_id);
      }

      await releaseHotelTableIfNoActiveOrders(order.table_id, order.table_number, orderId);

      return { invoiceId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-payments'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-sessions'] });
      scheduleHotelOrderSync(true);
      toast.success('Order settled successfully');
    },
    onError: (error: Error, _variables: any, context: any) => {
      if (context?.previousOrders) {
        context.previousOrders.forEach(([queryKey, oldData]: [any, any]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
      toast.error(error.message);
    },
  });
}

export function useCreateServiceOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderData: {
      booking_id: string;
      room_id: string | null;
      staff_id: string | null;
      shift_id: string | null;
      items: Array<{
        service_item_id?: string;
        name: string;
        quantity: number;
        unit_price: number;
        total_price: number;
        item_type: string;
        station: 'kitchen' | 'bar' | 'other';
      }>;
      subtotal?: number;
      tax_amount?: number;
      total_amount?: number;
      notes?: string;
    }) => {
      let subtotal = orderData.subtotal ?? Number(orderData.items.reduce((sum, i) => sum + i.total_price, 0).toFixed(2));
      let tax_amount = orderData.tax_amount;
      let total_amount = orderData.total_amount;

      if (tax_amount === undefined || total_amount === undefined) {
        const { data: hotelInfo } = await apiClient.from('hotel_info').select('tax_rate, tax_inclusive').maybeSingle();
        const taxRate = hotelInfo?.tax_rate ?? 18;
        const taxInclusive = hotelInfo?.tax_inclusive ?? false;

        if (taxInclusive) {
          total_amount = subtotal;
          tax_amount = Number((total_amount * (taxRate / (100 + taxRate))).toFixed(2));
        } else {
          tax_amount = Number((subtotal * (taxRate / 100)).toFixed(2));
          total_amount = Number((subtotal + tax_amount).toFixed(2));
        }
      }

      // --- NEW: Checkout Guard for Service Orders ---
      if (orderData.booking_id) {
        const { data: booking } = await apiClient
          .from('hotel_bookings')
          .select('status')
          .eq('id', orderData.booking_id)
          .single();
        
        if (booking?.status === 'checked_out') {
          throw new Error('Cannot create order for a checked-out booking');
        }
      }

      const orderId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      // 1. Create order
      const orderPayload = {
        id: orderId,
        booking_id: orderData.booking_id,
        room_id: orderData.room_id,
        staff_id: orderData.staff_id,
        shift_id: orderData.shift_id,
        waiter_id: orderData.staff_id,
        status: 'pending' as OrderStatus,
        kitchen_status: 'pending' as OrderStatus,
        bar_status: 'pending' as OrderStatus,
        subtotal,
        tax_amount,
        discount_amount: 0,
        total_amount,
        notes: orderData.notes,
        order_number: `SRV-${Date.now().toString().slice(-6)}`,
        created_at: timestamp,
        updated_at: timestamp,
      };

     const { error: orderInsertError } = await apiClient.from('hotel_orders').insert(orderPayload);
if (orderInsertError) {
  console.error('[usePlaceOrder] order insert failed:', orderInsertError);
  throw orderInsertError;
}

      // 2. Create items
      const items = orderData.items.map(item => ({
        id: crypto.randomUUID(),
        order_id: orderId,
        service_item_id: item.service_item_id,
        name: item.name,
        quantity: item.quantity,
        purchase_price: (item as any).purchase_price || 0,
        unit_price: item.unit_price,
        total_price: item.total_price,
        item_type: item.item_type,
        station: item.station,
        status: 'pending' as OrderStatus,
        created_at: timestamp,
        updated_at: timestamp,
      }));

      for (const item of items) {
        await apiClient.from('hotel_order_items').insert(item);
      }

      // Deduct inventory via backend RPC (handles both legacy and hotel systems)
      try {
        await apiClient.rpc('deduct_hotel_inventory_for_order', {
          p_order_id: orderId,
          p_items: items.map(item => ({
            service_item_id: item.service_item_id,
            quantity: item.quantity,
            name: item.name,
            station: item.station,
          })),
        });
      } catch (deductError) {
        console.error('Failed to deduct inventory for order:', deductError);
        // Don't block order creation if inventory deduction fails
      }

      if (orderData.shift_id) {
        await logShiftAction({
          shiftId: orderData.shift_id,
          staffId: orderData.staff_id || undefined,
          actionType: 'order_created',
          description: `Created service order #${orderPayload.order_number}`,
          referenceId: orderId,
        });
      }

      return orderPayload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      scheduleHotelOrderSync(true);
      toast.success('Service order created');
    },
    onError: (error: Error) => toast.error(`Failed to create order: ${error.message}`),
  });
}

export function useHandoffOrders() {
  const orders = useHotelOrders({ 
    status: ['pending_handover', 'awaiting_approval']
  }, {
    ignoreActiveStaffScope: true
  });
  
  // Filter out takeaway, delivery, and reservation orders from handoffs
  const filteredOrders = useMemo(() => {
    return orders.data?.filter(order => 
      !['takeaway', 'delivery', 'reservation'].includes(order.order_type || '')
    ) ?? [];
  }, [orders.data]);
  
  return { ...orders, data: filteredOrders };
}

export function useHotelOrders(
  filters?: { waiterId?: string; status?: string[] },
  options?: {
    enabled?: boolean;
    ignoreActiveStaffScope?: boolean;
    preferFresh?: boolean;
    refetchIntervalMs?: number | false;
    refetchOnMount?: boolean | 'always';
  }
) {
  const { activeStaff } = useStaffSession();
  const enabled = options?.enabled ?? true;
  const ignoreActiveStaffScope = options?.ignoreActiveStaffScope ?? false;
  const refetchIntervalMs = options?.refetchIntervalMs ?? false;
  const refetchOnMount = options?.refetchOnMount ?? false;
  const scopedFilters = useMemo(() => {
    return filters;
  }, [filters, ignoreActiveStaffScope]);

  return useQuery({
    queryKey: ['hotel-orders', scopedFilters, activeStaff?.staff_id, activeStaff?.role, ignoreActiveStaffScope],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateLimit = thirtyDaysAgo.toISOString();

      const baseQuery = apiClient
        .from('hotel_orders')
        .select(`
          *,
          items:hotel_order_items(*),
          session:hotel_table_sessions(
            id,
            table_id,
            table_number,
            guest_count,
            opened_by,
            opened_shift_id,
            status,
            payment_status,
            notes,
            opened_at,
            closed_at,
            created_at,
            updated_at
          ),
          room:hotel_rooms(id, room_number, room_type),
          booking:hotel_bookings(
            id,
            booking_reference,
            guest:hotel_guests(first_name, last_name)
          ),
          waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name, role),
          assigned_waiter:hotel_staff!hotel_orders_assigned_waiter_id_fkey(id, first_name, last_name, role)
        `)
        .gte('created_at', dateLimit)
        .order('created_at', { ascending: false });

      const scopedQuery = ignoreActiveStaffScope
        ? (scopedFilters?.waiterId ? (baseQuery as any).eq('waiter_id', scopedFilters.waiterId) : baseQuery)
        : applyOrderQueryScope(
            baseQuery as any,
            activeStaff,
            scopedFilters
          );

      const { data: remote, error } = await scopedQuery;
if (error) {
  console.error('hotel_orders fetch failed:', error);
  throw error;
}
if (!remote) return [];
      const filteredRemote = ignoreActiveStaffScope
        ? applyOrderFilters(remote as any, scopedFilters)
        : filterOrdersForStaff(remote as any, activeStaff, scopedFilters);
      
      return recalculateAllOrderTotals(sortOrdersNewestFirst(applyOrderFilters(filteredRemote, scopedFilters)));
    },
    staleTime: 45000,
    refetchOnWindowFocus: false,
    refetchOnMount,
    refetchInterval: () => {
      if (!enabled || refetchIntervalMs === false) return false;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
      return refetchIntervalMs;
    },
    enabled,
  });
}

export function useHotelOrdersRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // NOTE: Real-time websocket subscriptions (Supabase channels) are not yet
    // implemented on the Node/Express backend. Falling back to polling only
    // until a websocket layer (e.g. Socket.io) is added.
    const pollInterval = setInterval(() => {
      if (navigator.onLine && getIsBackendReachable()) {
        queryClient.invalidateQueries({ queryKey: ['hotel-orders'], refetchType: 'active' });
        queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'], refetchType: 'active' });
        queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'], refetchType: 'active' });
      }
    }, 15000); // Poll every 15s until real websocket support exists

    return () => {
      clearInterval(pollInterval);
    };
  }, [queryClient]);
}

const ACTIVE_ORDER_STATUSES = [...HOTEL_ACCESS_ACTIVE_ORDER_STATUSES];
const MONITOR_ORDER_STATUSES = ACTIVE_ORDER_STATUSES.filter(
  s => !['billed', 'paid', 'settled', 'cancelled'].includes(s)
);

export function useActiveOrders(waiterId?: string, options?: { enabled?: boolean }) {
  return useHotelOrders({ 
    status: ACTIVE_ORDER_STATUSES,
    waiterId: waiterId
  }, options);
}

export function useMonitorOrders(
  enabled: boolean = true,
  options?: { preferFresh?: boolean; refetchIntervalMs?: number | false }
) {
  const { activeStaff } = useStaffSession();
  const queryClient = useQueryClient();
  const refetchIntervalMs = options?.refetchIntervalMs ?? 5000;
  
  useEffect(() => {
    if (!enabled || !canUseRealtime()) return;
    if (typeof apiClient.channel !== 'function') return;
    
    const channel = apiClient
      .channel('hotel-orders-monitor')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_orders' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_order_items' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
        }
      )
      .subscribe();
      
    return () => {
      try { apiClient.removeChannel(channel); } catch {}
    };
  }, [enabled, queryClient]);
  
  return useQuery({
    queryKey: ['hotel-orders-monitor', activeStaff?.staff_id, activeStaff?.role],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateLimit = thirtyDaysAgo.toISOString();
      const monitorFilters = {
        status: MONITOR_ORDER_STATUSES,
      };
      
      let query = apiClient
        .from('hotel_orders')
        .select(`
          *,
          items:hotel_order_items(*),
          session:hotel_table_sessions(
            id, table_id, table_number, guest_count, opened_by, opened_shift_id, status, payment_status, notes, opened_at, closed_at, created_at, updated_at
          ),
          room:hotel_rooms(id, room_number, room_type),
          booking:hotel_bookings(id, booking_reference, guest:hotel_guests(first_name, last_name)),
          waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name, role),
          assigned_waiter:hotel_staff!hotel_orders_assigned_waiter_id_fkey(id, first_name, last_name, role)
        `)
        .in('status', MONITOR_ORDER_STATUSES)
        .gte('created_at', dateLimit)
        .order('created_at', { ascending: false });

      query = applyOrderQueryScope(
        query as any,
        activeStaff,
        monitorFilters
      );

      const { data: remote, error } = await query;
if (error) {
  console.error('[useMonitorOrders] fetch failed:', error);
  throw error;
}
if (!remote) return [];
      
      const filteredRemote = filterOrdersForStaff(remote as any, activeStaff, monitorFilters);
      return recalculateAllOrderTotals(sortOrdersNewestFirst(filteredRemote));
    },
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: enabled ? 'always' : false,
    refetchInterval: enabled ? refetchIntervalMs : false,
  });
}

export function useTableOccupancyOrders(
  enabled: boolean = true,
  options?: { refetchIntervalMs?: number | false }
) {
  const refetchIntervalMs = options?.refetchIntervalMs ?? 1000;

  return useQuery({
    queryKey: ['hotel-table-occupancy'],
    enabled,
    staleTime: 0,
    refetchInterval: () => {
      if (!enabled || refetchIntervalMs === false) return false;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
      return refetchIntervalMs;
    },
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateLimit = thirtyDaysAgo.toISOString();

      const [remoteOrders, remoteSessions] = await Promise.all([
        apiClient
          .from('hotel_orders')
          .select(`
            id,
            order_number,
            table_id,
            table_number,
            session_id,
            seat_id,
            waiter_id,
            staff_id,
            assigned_waiter_id,
            order_type,
            checked_in_at,
            status,
            created_at,
            updated_at,
            waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name, role),
            assigned_waiter:hotel_staff!hotel_orders_assigned_waiter_id_fkey(id, first_name, last_name, role)
          `)
          .gte('created_at', dateLimit)
          .order('updated_at', { ascending: false })
          .then(res => res.data),
        apiClient
          .from('hotel_table_sessions')
          .select(`
            id,
            table_id,
            table_number,
            opened_by,
            status,
            opened_at,
            created_at,
            updated_at,
            opener:hotel_staff!hotel_table_sessions_opened_by_fkey(id, first_name, last_name, role)
          `)
          .in('status', ['active', 'partially_paid'])
          .order('updated_at', { ascending: false })
          .then(res => res.data),
      ]);

      const tableLinkedOrders = (remoteOrders || []).filter((order) => {
        if (!(order.table_id || order.table_number)) {
          return false;
        }

        return (
          isUncheckedInReservationOrder(order as Partial<HotelOrder>) ||
          TABLE_OCCUPYING_ORDER_STATUSES.includes((order.status || 'pending') as OrderStatus)
        );
      });

      const merged = mergeTableOccupancyOrders(
        [],
        [
          ...tableLinkedOrders.map((order) => toTableOccupancyOrder(order as any)),
          ...(remoteSessions || []).map((session) => toTableOccupancySession(session as any)),
        ]
      );

      return sortOrdersNewestFirst(merged);
    },
  });
}

export function useWaiterOrders(waiterId: string | undefined, options?: { enabled?: boolean }) {
  const enabled = (options?.enabled ?? true) && !!waiterId;
  const filters = useMemo(
    () => (waiterId ? { waiterId, status: ACTIVE_ORDER_STATUSES } : undefined),
    [waiterId]
  );

  return useHotelOrders(filters, {
    ...options,
    enabled,
  });
}

export function useBillOrders(orderIds: string[] = []) {
  const { activeStaff } = useStaffSession();

  return useQuery({
    queryKey: ['hotel-orders-bill', orderIds, activeStaff?.staff_id, activeStaff?.role],
    queryFn: async () => {
      if (!orderIds || orderIds.length === 0) return [];
      
      const { data: remote } = await apiClient
        .from('hotel_orders')
        .select(`
          *,
          items:hotel_order_items(*)
        `)
        .in('id', orderIds);

      if (!remote) return [];
      
      const filtered = filterOrdersForStaff(remote as any, activeStaff);
      return recalculateAllOrderTotals(filtered);
    },
    enabled: !!orderIds && orderIds.length > 0,
  });
}

interface PlaceOrderParams {
  bookingId?: string | null;
  roomId?: string | null;
  tableId?: string | null;
  tableNumber?: string | null;
  sessionId?: string | null;
  seatId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  waiterId: string;
  staffId?: string | null;
  shiftId?: string | null;
  notes?: string;
  taxRate: number;
  taxInclusive?: boolean;
  discount?: number;
  paymentPlan?: 'full' | 'partial' | 'later' | null;
  orderType?: 'dine_in' | 'reservation' | 'takeaway' | 'delivery';
  reservationDate?: string | null;
  reservationTime?: string | null;
  partySize?: number | null;
  depositAmount?: number | null;
  depositPaidAt?: string | null;
  assignedWaiterId?: string | null;
  checkedInAt?: string | null;
  items: {
    serviceItemId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    notes?: string;
    category?: string;
    station?: ServiceStation;
    seatId?: string | null;
    seatNo?: number | null;
    paymentGroupId?: string | null;
  }[];
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  const { activeStaff, activeShift } = useStaffSession();

  return useMutation({
    mutationFn: async (orderData: PlaceOrderParams) => {
      console.log('[usePlaceOrder] START: Received orderData:', orderData);
      
      // Check if active staff is present
      if (!activeStaff?.staff_id) {
        console.error('[usePlaceOrder] No staff session active');
        throw new Error('No staff session active — please log in');
      }
      
      const orderId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const effectiveWaiterId =
        orderData.orderType === 'reservation'
          ? orderData.assignedWaiterId || orderData.waiterId || activeStaff.staff_id
          : orderData.waiterId || activeStaff.staff_id;
      
      console.log('[usePlaceOrder] Generated orderId:', orderId);
      
      const orderPayload = {
        id: orderId,
        booking_id: orderData.bookingId,
        customer_id: orderData.customerId || null,
        customer_name: orderData.customerName || null,
        customer_phone: orderData.customerPhone || null,
        customer_email: orderData.customerEmail || null,
        customer_address: orderData.customerAddress || null,
        order_type: orderData.orderType || 'dine_in',
        reservation_date: orderData.reservationDate || null,
        reservation_time: orderData.reservationTime || null,
        party_size: orderData.partySize || null,
        deposit_amount: Number(orderData.depositAmount || 0),
        deposit_paid_at: orderData.depositPaidAt || null,
        assigned_waiter_id: orderData.assignedWaiterId || null,
        checked_in_at: orderData.checkedInAt || null,
        room_id: orderData.roomId,
        table_id: orderData.tableId || null,
        table_number: orderData.tableNumber,
        session_id: orderData.sessionId || null,
        seat_id: orderData.seatId || null,
        waiter_id: effectiveWaiterId,
        staff_id: orderData.staffId || activeStaff.staff_id,
        shift_id: activeShift?.id || orderData.shiftId || null,
        status: 'pending' as OrderStatus,
        kitchen_status: 'pending' as OrderStatus,
        bar_status: 'pending' as OrderStatus,
        payment_plan: orderData.paymentPlan || null,
        payment_status: 'unpaid',
        amount_paid: 0,
        notes: orderData.notes,
        subtotal: orderData.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0),
        discount_amount: orderData.discount || 0,
        tax_amount: 0, // Calculated below
        total_amount: 0, // Calculated below
        order_number: `ORD-${Date.now().toString().slice(-6)}`,
        created_at: timestamp,
        updated_at: timestamp,
      };

      console.log('[usePlaceOrder] Created initial orderPayload:', orderPayload);

      // Recalculate totals
      const discountAmount = Number((orderData.discount || 0).toFixed(2));
      const taxRate = orderData.taxRate;
      const taxInclusive = orderData.taxInclusive ?? false;
      const subtotal = Number(orderData.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0).toFixed(2));
      
      orderPayload.subtotal = subtotal;
      orderPayload.discount_amount = discountAmount;

      if (taxInclusive) {
        orderPayload.total_amount = Number((subtotal - discountAmount).toFixed(2));
        orderPayload.tax_amount = Number((orderPayload.total_amount * (taxRate / (100 + taxRate))).toFixed(2));
      } else {
        const taxableAmount = Number((subtotal - discountAmount).toFixed(2));
        orderPayload.tax_amount = Number((taxableAmount * (taxRate / 100)).toFixed(2));
        orderPayload.total_amount = Number((taxableAmount + orderPayload.tax_amount).toFixed(2));
      }
      
      console.log('[usePlaceOrder] Calculated totals:', {
        subtotal: orderPayload.subtotal,
        discount: orderPayload.discount_amount,
        tax: orderPayload.tax_amount,
        total: orderPayload.total_amount
      });

      // --- NEW: Checkout Guard for New Orders ---
      if (orderData.bookingId) {
        console.log('[usePlaceOrder] Checking booking status for bookingId:', orderData.bookingId);
        const { data: booking } = await apiClient
          .from('hotel_bookings')
          .select('status')
          .eq('id', orderData.bookingId)
          .single();
        
        if (booking?.status === 'checked_out') {
          console.error('[usePlaceOrder] Booking is checked out');
          throw new Error('Cannot place order for a checked-out booking');
        }
        console.log('[usePlaceOrder] Booking status is valid:', booking);
      }
      
      // --- Defensive Check: Verify waiter exists and is active ---
      const targetWaiterId = effectiveWaiterId;
      console.log('[usePlaceOrder] Verifying staff exists and is active:', targetWaiterId);
      const { data: staffCheck } = await apiClient
        .from('hotel_staff')
        .select('id, is_active')
        .eq('id', targetWaiterId)
        .maybeSingle();
      
      if (!staffCheck || !staffCheck.is_active) {
        console.error('[usePlaceOrder] Staff not found or inactive:', staffCheck);
        throw new Error('Your staff session is no longer valid. Please log in again.');
      }
      console.log('[usePlaceOrder] Staff verified:', staffCheck);

      // 1. Save Order
      console.log('[usePlaceOrder] Inserting order into database...');
      const { error: insertError } = await apiClient.from('hotel_orders').insert(orderPayload);
      if (insertError) {
        console.error('[usePlaceOrder] Order insert failed:', insertError);
        throw insertError;
      }
      console.log('[usePlaceOrder] Order inserted successfully');
      
      if (orderData.tableId || orderData.tableNumber) {
        console.log('[usePlaceOrder] Setting table to occupied:', {
          tableId: orderData.tableId,
          tableNumber: orderData.tableNumber
        });
        await setHotelTableStatus(orderData.tableId, orderData.tableNumber, 'occupied');
        console.log('[usePlaceOrder] Table status updated');
      }

// FAST - parallel
// 2. Save items (parallel for speed)
const itemPayloads = orderData.items.map(item => ({
  id: crypto.randomUUID(),
  order_id: orderId,
  shift_id: activeShift?.id || orderData.shiftId || null,
  service_item_id: item.serviceItemId,
  name: item.name,
  quantity: item.quantity,
  purchase_price: (item as any).purchasePrice || 0,
  unit_price: item.unitPrice,
  total_price: item.unitPrice * item.quantity,
  seat_id: item.seatId || orderData.seatId || null,
  seat_no: item.seatNo || null,
  payment_group_id: item.paymentGroupId || null,
  notes: item.notes,
  station: (item as any).station || resolveServiceCategoryStation(item.category || 'food'),
  status: 'pending' as OrderStatus,
  created_at: timestamp,
  updated_at: timestamp,
}));
      
      console.log('[usePlaceOrder] Created itemPayloads:', itemPayloads);

// Validate: if items have seat_id, order must have session_id
const hasSeatedItems = itemPayloads.some(item => item.seat_id);
if (hasSeatedItems && !orderPayload.session_id) {
  console.error('[usePlaceOrder] Validation failed: Has seated items but no sessionId');
  throw new Error('Cannot create order with seat assignments: No table session provided. Please open a table session first.');
}

// Insert all items in parallel
console.log('[usePlaceOrder] Inserting items...');
const itemInsertResults = await Promise.all(
  itemPayloads.map(itemPayload =>
    apiClient.from('hotel_order_items').insert(itemPayload)
  )
);
const itemInsertError = itemInsertResults.find(r => r.error)?.error;
if (itemInsertError) {
  console.error('[usePlaceOrder] Item insert failed:', itemInsertError);
  throw itemInsertError;
}
console.log('[usePlaceOrder] All items inserted successfully');

// Deduct inventory for each item
console.log('[usePlaceOrder] Deducting inventory...');
await Promise.all(
  itemPayloads.map(itemPayload => deductLocalInventoryForOrderItem(itemPayload))
);
console.log('[usePlaceOrder] Inventory deducted');

      if (activeShift?.id) {
        console.log('[usePlaceOrder] Logging shift action...');
        await logShiftAction({
          shiftId: activeShift.id,
          staffId: activeStaff.staff_id,
          actionType: 'order_created',
          description: `Created service order #${orderPayload.order_number}`,
          referenceId: orderId,
        });
        console.log('[usePlaceOrder] Shift action logged');
      }

      console.log('[usePlaceOrder] END: Returning orderPayload:', orderPayload);
      return orderPayload;
    },
    onSuccess: (data) => {
      console.log('[usePlaceOrder] onSuccess called with data:', data);
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      scheduleHotelOrderSync(true);
      toast.success('Order placed successfully (Saved locally)');
    },
    onError: (error: Error) => {
      console.error('[usePlaceOrder] onError called:', error);
      toast.error(`Failed to place order: ${error.message}`);
    },
  });
}
export function useUpcomingReservations() {
  return useQuery({
    queryKey: ['hotel-reservations'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_orders')
        .select(`
          *,
          table:hotel_tables(*),
          waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name, role),
          assigned_waiter:hotel_staff!hotel_orders_assigned_waiter_id_fkey(id, first_name, last_name, role)
        `)
        .eq('order_type', 'reservation')
        .neq('status', 'cancelled')
        .is('checked_in_at', null)
        .order('reservation_date', { ascending: true });
      if (error) throw error;
      return (data || []) as HotelOrder[];
    },
    staleTime: 1000 * 60,
  });
}

export function useCheckInReservationOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orderId,
      assignedWaiterId,
    }: {
      orderId: string;
      assignedWaiterId: string;
    }) => {
      const { data, error } = await apiClient.rpc('check_in_reservation_order', {
        p_order_id: orderId,
        p_assigned_waiter_id: assignedWaiterId,
      });

      if (error) {
        throw new Error(error.message || 'Failed to check in reservation');
      }

      if (!data?.session_id) {
        throw new Error('Reservation check-in did not return a table session');
      }

      return {
        orderId: data.order_id || orderId,
        sessionId: data.session_id,
        tableId: data.table_id || null,
        tableNumber: data.table_number || null,
        assignedShiftId: data.assigned_shift_id || null,
        checkedInAt: data.checked_in_at || null,
      };
    },
    onSuccess: (_result) => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-reservations'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      scheduleHotelOrderSync(true);
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to check in reservation'),
  });
}

export function useCancelReservationNoShow() {
  const queryClient = useQueryClient();
  const { activeStaff, activeShift } = useStaffSession();

  return useMutation({
    mutationFn: async ({
      orderId,
      tableId,
      tableNumber,
    }: {
      orderId: string;
      tableId?: string | null;
      tableNumber?: string | null;
    }) => {
      const now = new Date().toISOString();
      const staffId = activeStaff?.staff_id || null;

      const { error: cancelError } = await apiClient
        .from('hotel_orders')
        .update({
          status: 'cancelled',
          cancel_reason: 'Reservation no-show',
          cancelled_at: now,
          cancelled_by: staffId,
          updated_at: now,
        })
        .eq('id', orderId);

      if (cancelError) {
        throw cancelError;
      }

      await releaseHotelTableIfNoActiveOrders(
        tableId || null,
        tableNumber || null,
        orderId,
        'free',
        queryClient
      );

      if (activeShift?.id && staffId) {
        await logShiftAction({
          shiftId: activeShift.id,
          staffId,
          actionType: 'reservation_no_show',
          description: `Marked reservation ${orderId} as no-show`,
          referenceId: orderId,
        }).catch((error) => {
          console.warn('Failed to log reservation no-show:', error);
        });
      }

      return { orderId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-reservations'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      scheduleHotelOrderSync(true);
      toast.success('Reservation marked as no-show');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to cancel reservation'),
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const { activeStaff, activeShift } = useStaffSession();

  return useMutation({
    mutationFn: async ({ 
      orderId, 
      status, 
      station,
      cancelReason,
      staffId: inputStaffId,
      shiftId: inputShiftId
    }: { 
      orderId: string; 
      status: OrderStatus; 
      station?: 'kitchen' | 'bar';
      cancelReason?: string;
      staffId?: string | null;
      shiftId?: string | null;
    }) => {
      // 1. Fetch current order locally
      let { data: currentOrder } = await apiClient.from('hotel_orders').select('*').eq('id', orderId).single();
      if (!currentOrder) throw new Error('Order not found locally');
      if (!canMutateOrderForRole(currentOrder, station)) {
        throw new Error('You are not allowed to update this order');
      }

      const staffId = inputStaffId || activeStaff?.staff_id;
      const shiftId = inputShiftId || activeShift?.id;

      if (!staffId) {
        throw new Error('No active staff session. Please log in.');
      }

      const updateData: any = { 
        id: orderId,
        updated_at: new Date().toISOString()
      };

      let newKitchenStatus = currentOrder.kitchen_status;
      let newBarStatus = currentOrder.bar_status;

      if (station === 'kitchen') {
        newKitchenStatus = status;
        updateData.kitchen_status = status;
        if (status === 'preparing') {
          updateData.preparing_started_at = new Date().toISOString();
          updateData.preparing_started_by = staffId;
        }
        if (status === 'ready') {
          updateData.ready_at = new Date().toISOString();
          updateData.ready_by = staffId;
        }
      } else if (station === 'bar') {
        newBarStatus = status;
        updateData.bar_status = status;
        if (status === 'preparing') {
          updateData.preparing_started_at = new Date().toISOString();
          updateData.preparing_started_by = staffId;
        }
        if (status === 'ready') {
          updateData.ready_at = new Date().toISOString();
          updateData.ready_by = staffId;
        }
      } else {
        newKitchenStatus = status;
        newBarStatus = status;
        updateData.kitchen_status = status;
        updateData.bar_status = status;
        if (status === 'preparing') {
          updateData.preparing_started_at = new Date().toISOString();
          updateData.preparing_started_by = staffId;
        }
        if (status === 'ready') {
          updateData.ready_at = new Date().toISOString();
          updateData.ready_by = staffId;
        }
        if (status === 'served') {
          updateData.served_at = new Date().toISOString();
          updateData.served_by = staffId;
        }
        if (status === 'billed') {
          updateData.billed_at = new Date().toISOString();
          updateData.billed_by = staffId;
        }
      }

      // Logic for global status:
      // Stock is already reserved when the order is created/updated, so
      // preparation now only advances workflow without deducting twice.
      if (status === 'preparing') {
        updateData.status = 'preparing';
        
        // Fetch items if not already on the order object
        let orderItems = currentOrder.items || [];
        if (orderItems.length === 0) {
          const { data: allItems } = await apiClient.from('hotel_order_items').select('*').eq('order_id', orderId);
          orderItems = allItems || [];
        }

        for (const item of orderItems) {
          if ((item.status === 'pending' || !item.status) && (station ? item.station === station : true)) {
            await apiClient.from('hotel_order_items').update({
                          id: item.id,
                          status: 'preparing',
                          updated_at: new Date().toISOString()
                        }).eq('id', {
                          id: item.id,
                          status: 'preparing',
                          updated_at: new Date().toISOString()
                        }.id || {
                          id: item.id,
                          status: 'preparing',
                          updated_at: new Date().toISOString()
                        }?.id);
          }
        }
      } else if (status === 'ready') {
        const isKitchenReady = newKitchenStatus === 'ready' || newKitchenStatus === 'served' || !newKitchenStatus;
        const isBarReady = newBarStatus === 'ready' || newBarStatus === 'served' || !newBarStatus;
        
        if (isKitchenReady && isBarReady) {
          updateData.status = 'ready';
        } else {
          updateData.status = 'preparing';
        }
      } else if (status === 'served') {
        const isKitchenServed = newKitchenStatus === 'served' || !newKitchenStatus;
        const isBarServed = newBarStatus === 'served' || !newBarStatus;
        
        if (isKitchenServed && isBarServed) {
          updateData.status = 'served';
        } else {
          updateData.status = 'ready';
        }
      } else {
        updateData.status = status;
      }

      if (status === 'cancelled' && cancelReason) {
        updateData.cancel_reason = cancelReason;
        updateData.cancelled_at = new Date().toISOString();
        updateData.cancelled_by = staffId;

        // Also cancel all items
        let orderItems = currentOrder.items || [];
        if (orderItems.length === 0) {
          const { data: allItems } = await apiClient.from('hotel_order_items').select('*').eq('order_id', orderId);
          orderItems = allItems || [];
        }
        for (const item of orderItems) {
          await apiClient.from('hotel_order_items').update({
            id: item.id,
            status: 'cancelled',
            cancel_reason: cancelReason,
            cancelled_at: new Date().toISOString(),
            cancelled_by: staffId,
            updated_at: new Date().toISOString()
          }).eq('id', item.id);
          
          // Restore local inventory for this item
          await restoreLocalInventoryForOrderItem(item);
        }
        
        // Recalculate order totals
        const activeItems = getActiveOrderItems([]); // No active items when fully cancelled
        const recalculatedTotals = calculateOrderTotalsFromSubtotal(currentOrder as any, 0);
        Object.assign(updateData, recalculatedTotals);

        // If the order was already paid/settled, record a void transaction to balance the shift
        if (currentOrder.status === 'settled' && shiftId) {
          const paymentMethod = currentOrder.payment_method || 'cash';
          // Use 'void' type for cash, otherwise use the original payment method type with negative amount
          const txType = paymentMethod === 'cash' ? 'void' : 
                         (paymentMethod === 'momo' ? 'momo' : 
                          (paymentMethod === 'card' ? 'card' : 
                           (paymentMethod === 'upi' ? 'upi' : 
                            (paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'void'))));

          await recordShiftTransaction({
            shiftId,
            staffId,
            type: txType as any,
            amount: -Number(currentOrder.total_amount || 0),
            referenceId: orderId,
          });
        }

      }

      // 2. Unified Operation
      await apiClient.from('hotel_orders').update(updateData).eq('id', updateData.id || updateData?.id);

      if ((currentOrder.table_id || currentOrder.table_number) && !isTableOccupyingOrderStatus(updateData.status)) {
        await releaseHotelTableIfNoActiveOrders(currentOrder.table_id, currentOrder.table_number, orderId);
      }

      if (shiftId) {
        await logShiftAction({
          shiftId,
          staffId,
          actionType: status === 'cancelled' ? 'order_cancelled' : 'order_status_updated',
          description: `${station ? station.toUpperCase() + ': ' : ''}Order #${orderId} status changed to ${status}${cancelReason ? `: ${cancelReason}` : ''}`,
          referenceId: orderId,
        });
      }
    },
    onMutate: async (newStatus) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ['hotel-orders'] });

      // Snapshot the previous value
      const previousOrders = queryClient.getQueriesData({ queryKey: ['hotel-orders'] });
      const optimisticTimestamp = new Date().toISOString();
      const staffId = newStatus.staffId || getStoredActiveStaff()?.staff_id;

      // Optimistically update to the new value across ALL order queries
      queryClient.setQueriesData({ queryKey: ['hotel-orders'] }, (old: any) => {
        if (!old) return old;
        
        // Handle both array of orders and single order responses
        if (Array.isArray(old)) {
          return old.map((order: any) => {
            if (order.id === newStatus.orderId) {
              let updated = { ...order };
              
              if (newStatus.station === 'kitchen') {
                updated.kitchen_status = newStatus.status;
                if (newStatus.status === 'preparing') {
                  updated.preparing_started_at = optimisticTimestamp;
                  updated.preparing_started_by = staffId;
                }
                if (newStatus.status === 'ready') {
                  updated.ready_at = optimisticTimestamp;
                  updated.ready_by = staffId;
                }
              } else if (newStatus.station === 'bar') {
                updated.bar_status = newStatus.status;
                if (newStatus.status === 'preparing') {
                  updated.preparing_started_at = optimisticTimestamp;
                  updated.preparing_started_by = staffId;
                }
                if (newStatus.status === 'ready') {
                  updated.ready_at = optimisticTimestamp;
                  updated.ready_by = staffId;
                }
              } else {
                updated.status = newStatus.status;
                if (newStatus.status === 'preparing') {
                  updated.preparing_started_at = optimisticTimestamp;
                  updated.preparing_started_by = staffId;
                }
                if (newStatus.status === 'ready') {
                  updated.ready_at = optimisticTimestamp;
                  updated.ready_by = staffId;
                }
                if (newStatus.status === 'served') {
                  updated.served_at = optimisticTimestamp;
                  updated.served_by = staffId;
                }
                if (newStatus.status === 'billed') {
                  updated.billed_at = optimisticTimestamp;
                  updated.billed_by = staffId;
                }
              }

              // If cancelling, also update all items and cancel fields
              if (newStatus.status === 'cancelled' && newStatus.cancelReason) {
                updated.cancel_reason = newStatus.cancelReason;
                updated.cancelled_at = optimisticTimestamp;
                updated.cancelled_by = staffId;
                
                if (updated.items && Array.isArray(updated.items)) {
                  updated.items = updated.items.map((item: any) => ({
                    ...item,
                    status: 'cancelled',
                    cancel_reason: newStatus.cancelReason,
                    cancelled_at: optimisticTimestamp,
                    cancelled_by: staffId,
                    updated_at: optimisticTimestamp
                  }));
                }
                
                // Recalculate totals optimistically
                const recalculatedTotals = calculateOrderTotalsFromSubtotal(updated, 0);
                Object.assign(updated, recalculatedTotals);
              }
              
              return updated;
            }
            return order;
          });
        }
        return old;
      });

      return { previousOrders };
    },
    onError: (err, newStatus, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousOrders) {
        context.previousOrders.forEach(([queryKey, oldData]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
      toast.error(`Update failed: ${err.message}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      scheduleHotelOrderSync(true);
    },
    onSuccess: () => {
      toast.success('Status updated');
    },
  });
}

export function useUpdateOrderItemStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, status }: { itemId: string; status: string }) => {
      // 1. Fetch item from local storage first
      let { data: item } = await apiClient.from('hotel_order_items').select('*').eq('id', itemId).single();
      
      if (!item) {
        // Fallback to remote if not found locally
        const { data: remoteItem } = await apiClient
          .from('hotel_order_items')
          .select('order_id, station, status')
          .eq('id', itemId)
          .single();
        if (!remoteItem) throw new Error('Item not found');
        item = remoteItem as any;
      }

      const { data: parentOrder } = await apiClient.from('hotel_orders').select('*').eq('id', item.order_id).single();
      if (!parentOrder || !canMutateOrderForRole(parentOrder, item.station as 'kitchen' | 'bar')) {
        throw new Error('You are not allowed to update this ticket item');
      }

      // 2. Update the item locally and queue sync
      await apiClient.from('hotel_order_items').update({ 
              id: itemId, 
              status, 
              updated_at: new Date().toISOString() 
            }).eq('id', { 
              id: itemId, 
              status, 
              updated_at: new Date().toISOString() 
            }.id || { 
              id: itemId, 
              status, 
              updated_at: new Date().toISOString() 
            }?.id);

      // 3. Check if all items for this station in the order are ready/served
      if (status === 'ready' || status === 'served') {
        const { data: allItems } = await apiClient.from('hotel_order_items').select('*').eq('order_id', item.order_id);
        const orderItems = (allItems || []).filter((i: any) => i.order_id === item.order_id && i.station === item.station);
        // Add the current updated item's new status since allItems is stale
        const allReady = orderItems.every(i => (i.id === itemId ? status : i.status) === 'ready' || (i.id === itemId ? status : i.status) === 'served');
        
        if (allReady) {
          const updateData: any = { 
            id: item.order_id,
            updated_at: new Date().toISOString() 
          };
          
          if (item.station === 'kitchen') updateData.kitchen_status = 'ready';
          if (item.station === 'bar') updateData.bar_status = 'ready';

          // Fetch order to check other station
          const { data: order } = await apiClient.from('hotel_orders').select('*').eq('id', item.order_id).single();

          if (order) {
            const isKitchenReady = item.station === 'kitchen' ? true : (order.kitchen_status === 'ready' || order.kitchen_status === 'served' || !order.kitchen_status);
            const isBarReady = item.station === 'bar' ? true : (order.bar_status === 'ready' || order.bar_status === 'served' || !order.bar_status);

            if (isKitchenReady && isBarReady) {
              updateData.status = 'ready';
            }
          }

          await apiClient.from('hotel_orders').update(updateData).eq('id', updateData.id || updateData?.id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      scheduleHotelOrderSync(true);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateOrderItemQuantity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      itemId,
      quantity,
      staffId,
      shiftId,
    }: {
      itemId: string;
      quantity: number;
      staffId?: string | null;
      shiftId?: string | null;
    }) => {
      if (quantity <= 0) {
        throw new Error('Quantity must be at least 1 — remove the item instead');
      }

      const { data: item } = await apiClient.from('hotel_order_items').select('*').eq('id', itemId).single();
      if (!item) throw new Error('Item not found');
      if (item.status === 'cancelled') throw new Error('Cannot update a cancelled item');

      const orderId = item.order_id;
      const { data: currentOrder } = await apiClient.from('hotel_orders').select('*').eq('id', orderId).single();
      if (!currentOrder) throw new Error('Order not found');

      if (!canMutateOrderForRole(currentOrder, item.station as 'kitchen' | 'bar')) {
        throw new Error('You are not allowed to update this order');
      }

      const oldQuantity = Number(item.quantity);
      const delta = quantity - oldQuantity;
      if (delta === 0) return { orderId, itemId, quantity };

      const oldTotalPrice = Number(item.total_price || 0);
      const newTotalPrice = Number((quantity * Number(item.unit_price)).toFixed(2));

      await apiClient.from('hotel_order_items').update({
        id: itemId,
        quantity,
        total_price: newTotalPrice,
        updated_at: new Date().toISOString(),
      }).eq('id', itemId);

      const deltaItem = { ...item, quantity: Math.abs(delta) };
      if (delta > 0) {
        await deductLocalInventoryForOrderItem(deltaItem);
      } else {
        await restoreLocalInventoryForOrderItem(deltaItem);
      }

      const { data: hotelInfo } = await apiClient.from('hotel_info').select('tax_rate, tax_inclusive').maybeSingle();
      const taxRate = hotelInfo?.tax_rate ?? 18;
      const taxInclusive = hotelInfo?.tax_inclusive ?? false;

      const priceDelta = Number((newTotalPrice - oldTotalPrice).toFixed(2));
      const newSubtotal = Number(Math.max(0, Number(currentOrder.subtotal) + priceDelta).toFixed(2));
      const discountAmt = Number(Number(currentOrder.discount_amount || 0).toFixed(2));

      let newTaxAmt: number, newTotalAmt: number;
      if (taxInclusive) {
        newTotalAmt = Number(Math.max(0, newSubtotal - discountAmt).toFixed(2));
        newTaxAmt = Number((newTotalAmt * (taxRate / (100 + taxRate))).toFixed(2));
      } else {
        const taxableAmount = Number(Math.max(0, newSubtotal - discountAmt).toFixed(2));
        newTaxAmt = Number((taxableAmount * (taxRate / 100)).toFixed(2));
        newTotalAmt = Number((taxableAmount + newTaxAmt).toFixed(2));
      }

      await apiClient.from('hotel_orders').update({
        id: orderId,
        subtotal: newSubtotal,
        tax_amount: newTaxAmt,
        total_amount: newTotalAmt,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);

      if (shiftId) {
        await logShiftAction({
          shiftId,
          staffId: staffId || undefined,
          actionType: 'order_item_quantity_updated',
          description: `Updated "${item.name}" quantity from ${oldQuantity} to ${quantity} on order #${currentOrder.order_number}`,
          referenceId: itemId,
        });
      }

      return { orderId, itemId, quantity };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      scheduleHotelOrderSync(true);
      toast.success('Quantity updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POS Handle — unsettled takeaway / delivery / reservation orders
// ─────────────────────────────────────────────────────────────────────────────

const UNSETTLED_ORDER_TYPES = ['takeaway', 'delivery', 'reservation'];

export function useUnsettledOrders(
  enabled: boolean = true,
  options?: { preferFresh?: boolean; refetchIntervalMs?: number | false }
) {
  const { activeStaff } = useStaffSession();
  const queryClient = useQueryClient();
  const refetchIntervalMs = options?.refetchIntervalMs ?? 5000;

  useEffect(() => {
    if (!enabled || !canUseRealtime()) return;
    if (typeof apiClient.channel !== 'function') return;

    const channel = apiClient
      .channel('hotel-orders-unsettled')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_orders' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_order_items' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
        }
      )
      .subscribe();

    return () => {
      try { apiClient.removeChannel(channel); } catch {}
    };
  }, [enabled, queryClient]);

  return useQuery({
    queryKey: ['hotel-orders-unsettled', activeStaff?.staff_id, activeStaff?.role],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateLimit = thirtyDaysAgo.toISOString();

      let baseQuery = apiClient
        .from('hotel_orders')
        .select(`
          *,
          items:hotel_order_items(*),
          session:hotel_table_sessions(
            id, table_id, table_number, guest_count, opened_by, opened_shift_id, status, payment_status, notes, opened_at, closed_at, created_at, updated_at
          ),
          room:hotel_rooms(id, room_number, room_type),
          booking:hotel_bookings(id, booking_reference, guest:hotel_guests(first_name, last_name)),
          waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name, role),
          assigned_waiter:hotel_staff!hotel_orders_assigned_waiter_id_fkey(id, first_name, last_name, role)
        `)
        .in('order_type', UNSETTLED_ORDER_TYPES)
        .gte('created_at', dateLimit)
        .order('created_at', { ascending: false });

      const scopedQuery = applyOrderQueryScope(baseQuery as any, activeStaff, {});
      const response = await scopedQuery as { data: HotelOrder[] | null; error: any };
      const remote = response.data;
      const error = response.error;
      
      if (error) {
        console.error('[useUnsettledOrders] fetch failed:', error);
        throw error;
      }
      if (!remote) return [];

      const filteredRemote = filterOrdersForStaff(remote as any, activeStaff)
  .filter((order: any) => !['settled', 'cancelled'].includes(String(order.status || '').toLowerCase()));
return recalculateAllOrderTotals(sortOrdersNewestFirst(filteredRemote));
    },
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: enabled ? 'always' : false,
    refetchInterval: enabled ? refetchIntervalMs : false,
  });
}

export function useCompleteOrder() {
  const queryClient = useQueryClient();
  const supportedPaymentMethods = new Set<HotelPOSPayment['method']>([
    'cash',
    'card',
    'momo',
    'bank_transfer',
    'upi',
  ]);

  return useMutation({
    mutationFn: async ({
      orderId,
      payments,
    }: {
      orderId: string;
      payments: HotelPOSPayment[];
    }) => {
      // 1. Fetch the current order (try local first, then remote)
      const { data: localOrder } = await apiClient.from('hotel_orders').select('*').eq('id', orderId).single();
      let order = localOrder || null;

      if (!order && navigator.onLine) {
        const { data: remoteOrder } = await apiClient
          .from('hotel_orders')
          .select(`
            *,
            items:hotel_order_items(*),
            booking:hotel_bookings(id, guest_id)
          `)
          .eq('id', orderId)
          .single();
        if (remoteOrder) order = remoteOrder as HotelOrder;
      }

      if (!order) throw new Error('Order not found');

      // 2. Fetch items if not attached
      let items = Array.isArray((order as any).items) ? (order as any).items : [];
      if (items.length === 0) {
        const { data: localItems } = await apiClient.from('hotel_order_items').select('*').eq('order_id', orderId);
        items = localItems || [];
      }

      if (items.length === 0 && navigator.onLine) {
        const { data: remoteItems, error: remoteItemsError } = await apiClient
          .from('hotel_order_items')
          .select('*')
          .eq('order_id', orderId);

        if (remoteItemsError) throw remoteItemsError;
        items = remoteItems || [];
      }

      if (items.length === 0) {
        throw new Error('Cannot complete this order because no order items were found');
      }

      // 3. Calculate payment totals
      const normalizedPayments = (payments || [])
        .map((payment) => ({
          method: payment.method,
          amount: Number(payment.amount || 0),
        }))
        .filter((payment) => payment.amount > 0);
      const paymentTotal = normalizedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const currentAmountPaid = Number(order.amount_paid || 0);
      const totalAmount = Number(order.total_amount || 0);
      const isTakeawayOrder = ['takeaway', 'delivery', 'reservation'].includes(order.order_type || '');
      const balanceBeforePayment = getOrderBalanceDue(order);
      const alreadyPaid = isTakeawayOrder && balanceBeforePayment <= 0;
      const fallbackPaymentMethod = supportedPaymentMethods.has(order.payment_method as HotelPOSPayment['method'])
        ? order.payment_method as HotelPOSPayment['method']
        : null;

      let newAmountPaid = currentAmountPaid;
      let newPaymentStatus: 'unpaid' | 'partial' | 'paid';

      if (alreadyPaid) {
        // Order already paid in waiter POS, just settle it here
        newAmountPaid = currentAmountPaid;
        newPaymentStatus = 'paid';
      } else {
        // Normal payment collection
        newAmountPaid = Number((currentAmountPaid + paymentTotal).toFixed(2));
        const effectivePaid = Number(
          (newAmountPaid + getReservationDepositCredit(order)).toFixed(2)
        );
        if (effectivePaid >= totalAmount) {
          newPaymentStatus = 'paid';
        } else if (newAmountPaid > 0) {
          newPaymentStatus = 'partial';
        } else {
          newPaymentStatus = 'unpaid';
        }
      }

      // 4. Update order with payment tracking fields
      const updateData: any = {
        id: orderId,
        amount_paid: newAmountPaid,
        payment_status: newPaymentStatus,
        updated_at: new Date().toISOString(),
      };

      // If fully paid, also mark status as settled and is_billed
      if (newPaymentStatus === 'paid') {
        updateData.status = 'settled';
        updateData.is_billed = true;
        updateData.settled_at = new Date().toISOString();
        updateData.settled_by = getStoredActiveStaff()?.staff_id || null;
      }

      await apiClient.from('hotel_orders').update(updateData).eq('id', orderId);

      // 5. Create or append invoice
      let invoiceId = order.invoice_id;
      let invoiceNumber: string;

      if (invoiceId) {
        // Append to existing invoice
        const { data: existingInvoice } = await apiClient
          .from('hotel_invoices')
          .select('*')
          .eq('id', invoiceId)
          .single();

        if (existingInvoice) {
          invoiceNumber = existingInvoice.invoice_number;
        } else {
          invoiceId = crypto.randomUUID();
          invoiceNumber = `INV-COM-${Math.floor(Math.random() * 1000000)}`;
        }
      } else {
        invoiceId = crypto.randomUUID();
        invoiceNumber = `INV-COM-${Math.floor(Math.random() * 1000000)}`;
      }

     if (!order.invoice_id) {
  const initialInvoicePaymentMethod =
    normalizedPayments.length > 1
      ? 'split'
      : (normalizedPayments[0]?.method || fallbackPaymentMethod || order.payment_method || null);

  const invoiceData = {
          id: invoiceId,
          invoice_number: invoiceNumber,
          booking_id: order.booking_id || null,
          guest_id: (order as any).booking?.guest_id || null,
          customer_id: order.customer_id || null,
          customer_name: order.customer_name || null,
          customer_phone: order.customer_phone || null,
          customer_email: order.customer_email || null,
          customer_address: order.customer_address || null,
          subtotal: Number(order.subtotal),
          tax_amount: Number(order.tax_amount),
          discount_amount: Number(order.discount_amount || 0),
          total_amount: Number(order.total_amount),
          payment_method: initialInvoicePaymentMethod,
          payment_status: newPaymentStatus,
          notes: 'Completed via POS Handle',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        await apiClient.from('hotel_invoices').insert(invoiceData);

        // Add items to invoice
        for (const item of items) {
          const invoiceItem = {
            id: crypto.randomUUID(),
            invoice_id: invoiceId,
            description: item.name,
            item_type: 'order',
            unit_price: item.unit_price,
            quantity: item.quantity,
            total_price: item.total_price,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          await apiClient.from('hotel_invoice_items').insert(invoiceItem);
        }

        // Link invoice to order
        await apiClient.from('hotel_orders').update({
          invoice_id: invoiceId,
          updated_at: new Date().toISOString(),
        }).eq('id', orderId);
      }

      const [{ data: paymentsByInvoice }, { data: paymentsByOrder }] = await Promise.all([
  apiClient.from('hotel_payments').select('id, amount, payment_method, status, order_id, invoice_id').eq('invoice_id', invoiceId),
  apiClient.from('hotel_payments').select('id, amount, payment_method, status, order_id, invoice_id').eq('order_id', orderId),
]);
const paymentRowsById = new Map<string, any>();
[...(paymentsByInvoice || []), ...(paymentsByOrder || [])].forEach((p: any) => paymentRowsById.set(p.id, p));
const existingInvoicePayments = Array.from(paymentRowsById.values());

const postedInvoicePayments = (existingInvoicePayments || []).filter((payment: any) =>
  !['cancelled', 'void'].includes(String(payment.status || '').toLowerCase()) &&
  Number(payment.amount || 0) > 0
);

// Backfill invoice_id onto payments that were recorded before this invoice existed
// (e.g. split payments taken in the waiter's Split Bill flow), so the Invoices
// tab shows the correct payment-method breakdown for this order going forward.
const paymentsNeedingInvoiceLink = postedInvoicePayments.filter((p: any) => !p.invoice_id);
if (paymentsNeedingInvoiceLink.length > 0) {
  await Promise.all(
    paymentsNeedingInvoiceLink.map((p: any) =>
      apiClient.from('hotel_payments').update({ invoice_id: invoiceId, updated_at: new Date().toISOString() }).eq('id', p.id)
    )
  );
}

    

      let effectivePayments = normalizedPayments;

      if (effectivePayments.length === 0 && postedInvoicePayments.length === 0 && newPaymentStatus === 'paid' && currentAmountPaid > 0) {
        if (!fallbackPaymentMethod) {
          throw new Error('This paid order is missing a supported payment method, so POS Handle cannot post it correctly.');
        }

        effectivePayments = [{
          method: fallbackPaymentMethod,
          amount: currentAmountPaid,
        }];
      }

      const paymentMethodSummary =
        effectivePayments.length > 1
          ? 'split'
          : (effectivePayments[0]?.method ||
              (postedInvoicePayments.length > 1
                ? 'split'
                : (postedInvoicePayments[0]?.payment_method || order.payment_method || null)));

      if (paymentMethodSummary && paymentMethodSummary !== order.payment_method) {
        await apiClient.from('hotel_orders').update({
          payment_method: paymentMethodSummary,
          updated_at: new Date().toISOString(),
        }).eq('id', orderId);

        await apiClient.from('hotel_invoices').update({
          payment_method: paymentMethodSummary,
          updated_at: new Date().toISOString(),
        }).eq('id', invoiceId);
      }

      // 6. Record payment(s) via recordHotelInvoicePayment
      const staff = getStoredActiveStaff();
      for (const payment of effectivePayments) {
        await recordHotelInvoicePayment({
          invoiceId,
          paymentMethod: payment.method as any,
          amountPaid: Number(payment.amount || 0),
          shiftId: order.shift_id || null,
          staffId: staff?.staff_id || null,
          sessionId: order.session_id || null,
          receiptNo: invoiceNumber,
          notes: 'POS Handle completion payment',
        });
      }

      // 7. Recalculate invoice totals
      try {
        await recalculateInvoiceTotals(invoiceId);
      } catch (e) {
        console.warn('[useCompleteOrder] recalculateInvoiceTotals failed:', e);
      }

      // 8. Release table if fully paid
      if (newPaymentStatus === 'paid' && (order.table_id || order.table_number)) {
        await releaseHotelTableIfNoActiveOrders(order.table_id, order.table_number, orderId);
      }

      return { invoiceId, invoiceNumber, paymentStatus: newPaymentStatus };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-unsettled'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-payments'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      scheduleHotelOrderSync(true);
      toast.success('Order completed successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to complete order: ${error.message}`);
    },
  });
}

export function useCancelOrderItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      itemId,
      staffId,
      shiftId,
      cancelReason
    }: { 
      itemId: string;
      staffId?: string | null;
      shiftId?: string | null;
      cancelReason?: string;
    }) => {
      // 1. Fetch item and its parent order
      const { data: item } = await apiClient.from('hotel_order_items').select('*').eq('id', itemId).single();
      if (!item) throw new Error('Item not found');
      if (item.status === 'cancelled') return;

      const orderId = item.order_id;
      let { data: currentOrder } = await apiClient.from('hotel_orders').select('*').eq('id', orderId).single();
      
      if (!currentOrder && navigator.onLine) {
        const { data: remoteOrder } = await apiClient
          .from('hotel_orders')
          .select('subtotal, total_amount, tax_amount, discount_amount, order_number, created_at, waiter_id, staff_id, status')
          .eq('id', orderId)
          .single();
        if (remoteOrder) currentOrder = remoteOrder as HotelOrder;
      }

      if (!currentOrder) throw new Error('Order not found');
      
      const staff = getStoredActiveStaff();
      const isManager = ["manager", "owner", "admin"].includes(staff?.role?.toLowerCase() || "");
      const isWaiter = staff?.role === "waiter";
      const isOwner = !!staff?.staff_id && [currentOrder.waiter_id, currentOrder.staff_id].includes(staff.staff_id);
      const orderAgeMs = Date.now() - new Date(currentOrder.created_at).getTime();
      const withinCancelWindow = orderAgeMs <= 10 * 60 * 1000;

      if (!isManager) {
        if (!isWaiter || !isOwner) {
          throw new Error('You can only cancel items on your own orders');
        }
        if (!withinCancelWindow) {
          throw new Error('Cancellation window (10 minutes) has expired');
        }
      }

      // 2. Update item status to cancelled
      await apiClient.from('hotel_order_items').update({ 
              id: itemId, 
              status: 'cancelled', 
              cancel_reason: cancelReason,
              cancelled_at: new Date().toISOString(),
              cancelled_by: staffId,
              updated_at: new Date().toISOString() 
            }).eq('id', { 
              id: itemId, 
              status: 'cancelled', 
              cancel_reason: cancelReason,
              cancelled_at: new Date().toISOString(),
              cancelled_by: staffId,
              updated_at: new Date().toISOString() 
            }.id || { 
              id: itemId, 
              status: 'cancelled', 
              cancel_reason: cancelReason,
              cancelled_at: new Date().toISOString(),
              cancelled_by: staffId,
              updated_at: new Date().toISOString() 
            }?.id);
      
      // Restore local inventory for this item
      await restoreLocalInventoryForOrderItem(item);

      // 3. Recalculate order totals
      const { data: hotelInfo } = await apiClient.from('hotel_info').select('tax_rate, tax_inclusive').maybeSingle();
      const taxRate = hotelInfo?.tax_rate ?? 18;
      const taxInclusive = hotelInfo?.tax_inclusive ?? false;

      const itemTotal = Number(item.total_price || 0);
      const newSubtotal = Number(Math.max(0, Number(currentOrder.subtotal) - itemTotal).toFixed(2));
      const discountAmt = Number(Number(currentOrder.discount_amount).toFixed(2));
      
      let newTaxAmt, newTotalAmt;
      if (taxInclusive) {
        newTotalAmt = Number(Math.max(0, newSubtotal - discountAmt).toFixed(2));
        newTaxAmt = Number((newTotalAmt * (taxRate / (100 + taxRate))).toFixed(2));
      } else {
        const taxableAmount = Number(Math.max(0, newSubtotal - discountAmt).toFixed(2));
        newTaxAmt = Number((taxableAmount * (taxRate / 100)).toFixed(2));
        newTotalAmt = Number((taxableAmount + newTaxAmt).toFixed(2));
      }

      // 4. Update order totals
      const updateData: any = {
        id: orderId,
        subtotal: newSubtotal,
        tax_amount: newTaxAmt,
        total_amount: newTotalAmt,
        updated_at: new Date().toISOString()
      };

      // If the order was already paid/settled, record a refund transaction for the difference
      if (currentOrder.status === 'settled' && shiftId) {
        const refundAmount = Number(currentOrder.total_amount) - newTotalAmt;
        if (refundAmount > 0) {
          const paymentMethod = currentOrder.payment_method || 'cash';
          // Use 'refund' type for cash, otherwise use the original payment method type with negative amount
          const txType = paymentMethod === 'cash' ? 'refund' : 
                         (paymentMethod === 'momo' ? 'momo' : 
                          (paymentMethod === 'card' ? 'card' : 
                           (paymentMethod === 'upi' ? 'upi' : 
                            (paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'refund'))));

          await recordShiftTransaction({
            shiftId,
            staffId: staffId || undefined,
            type: txType as any,
            amount: -Number(refundAmount.toFixed(2)),
            referenceId: itemId,
          });
        }
      }

      // Check if all items are now cancelled, if so, cancel the whole order
      const { data: allItems } = await apiClient.from('hotel_order_items').select('*').eq('order_id', orderId);
      const remainingItems = (allItems || []).filter((i: any) => i.order_id === orderId && i.id !== itemId && i.status !== 'cancelled');
      if (remainingItems.length === 0) {
        updateData.status = 'cancelled';
        updateData.cancelled_at = new Date().toISOString();
        updateData.cancelled_by = staffId;
        updateData.cancel_reason = "All items cancelled individually";
      }

      await apiClient.from('hotel_orders').update(updateData).eq('id', updateData.id || updateData?.id);

      if (updateData.status === 'cancelled') {
        await releaseHotelTableIfNoActiveOrders(currentOrder.table_id, currentOrder.table_number, orderId);
      }

      // 5. Log action
      if (shiftId) {
        await logShiftAction({
          shiftId,
          staffId: staffId || undefined,
          actionType: 'order_item_cancelled',
          description: `Cancelled item "${item.name}" from order #${currentOrder.order_number}`,
          referenceId: itemId,
        });
      }

      return { orderId, itemId };
    },
    onMutate: async ({ itemId, cancelReason, staffId }) => {
      await queryClient.cancelQueries({ queryKey: ['hotel-orders'] });

      const previousOrders = queryClient.getQueriesData({ queryKey: ['hotel-orders'] });
      const optimisticTimestamp = new Date().toISOString();

      queryClient.setQueriesData({ queryKey: ['hotel-orders'] }, (old: any) => {
        if (!Array.isArray(old)) return old;

        return old.map((order: any) => {
          const existingItems = Array.isArray(order?.items) ? order.items : null;
          if (!existingItems?.some((orderItem: any) => orderItem.id === itemId)) {
            return order;
          }

          const nextItems = existingItems.map((orderItem: any) => {
            if (orderItem.id !== itemId) return orderItem;
            return {
              ...orderItem,
              status: 'cancelled',
              cancel_reason: cancelReason ?? orderItem.cancel_reason ?? null,
              cancelled_at: optimisticTimestamp,
              cancelled_by: staffId ?? orderItem.cancelled_by ?? null,
              updated_at: optimisticTimestamp,
            };
          });

          const activeItems = getActiveOrderItems(nextItems);
          const nextSubtotal =
            activeItems.length > 0
              ? activeItems.reduce((sum, orderItem) => sum + Number(orderItem.total_price || 0), 0)
              : 0;
          const recalculatedTotals = calculateOrderTotalsFromSubtotal(order, nextSubtotal);
          const allItemsCancelled = nextItems.length > 0 && activeItems.length === 0;

          return {
            ...order,
            ...recalculatedTotals,
            items: nextItems,
            status: allItemsCancelled ? 'cancelled' : order.status,
            cancel_reason: allItemsCancelled
              ? (cancelReason || 'All items cancelled individually')
              : order.cancel_reason,
            cancelled_at: allItemsCancelled ? optimisticTimestamp : order.cancelled_at,
            cancelled_by: allItemsCancelled ? (staffId ?? order.cancelled_by ?? null) : order.cancelled_by,
            updated_at: optimisticTimestamp,
          };
        });
      });

      return { previousOrders };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousOrders) {
        context.previousOrders.forEach(([queryKey, oldData]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
      toast.error(`Failed to cancel item: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      scheduleHotelOrderSync(true);
      toast.success('Item cancelled and totals updated');
    },
  });
}

export function useAddItemsToOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      orderId, 
      items,
      sessionId,
      taxRate,
      taxInclusive
    }: { 
      orderId: string; 
      items: {
        serviceItemId: string | null;
        name: string;
        quantity: number;
        unitPrice: number;
        notes?: string;
        category?: string;
        station?: ServiceStation;
        seatId?: string | null;
        seatNo?: number | null;
        paymentGroupId?: string | null;
      }[];
      sessionId?: string | null;
      taxRate?: number;
      taxInclusive?: boolean;
    }) => {
      // 1. Calculate additional amounts
      const additionalSubtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

      // 2. Fetch current order to update totals
      const { data: currentOrderData } = await apiClient.from('hotel_orders').select('*').eq('id', orderId).single();
      let currentOrder = currentOrderData || null;
      
      if (!currentOrder && navigator.onLine) {
        const { data: remoteOrder } = await apiClient
          .from('hotel_orders')
          .select('subtotal, total_amount, tax_amount, discount_amount, shift_id, status, session_id, table_id, table_number')
          .eq('id', orderId)
          .single();
        if (remoteOrder) currentOrder = remoteOrder as HotelOrder;
      }

      if (!currentOrder) throw new Error('Order not found');
      if (!canManageHotelOrder(getStoredActiveStaff(), currentOrder)) {
        throw new Error('You can only add items to your own orders');
      }

      const effectiveSessionId = currentOrder.session_id || sessionId || null;

      // Check if any items have seat_id assignment - requires order to have session_id
      const hasSeatedItems = items.some(item => item.seatId || item.seatNo);
      if (hasSeatedItems && !effectiveSessionId) {
        throw new Error('Cannot assign seats: Order does not have an active table session. Please ensure the table session is created first.');
      }

      // Fetch hotel info if tax settings not provided
      let effectiveTaxRate = taxRate;
      let effectiveTaxInclusive = taxInclusive;

      if (effectiveTaxRate === undefined || effectiveTaxInclusive === undefined) {
        const { data: hotelInfo } = await apiClient.from('hotel_info').select('tax_rate, tax_inclusive').maybeSingle();
        if (effectiveTaxRate === undefined) effectiveTaxRate = hotelInfo?.tax_rate ?? 18;
        if (effectiveTaxInclusive === undefined) effectiveTaxInclusive = hotelInfo?.tax_inclusive ?? false;
      }

      const newSubtotal = Number((Number(currentOrder.subtotal) + additionalSubtotal).toFixed(2));
      const discountAmt = Number(Number(currentOrder.discount_amount).toFixed(2));
      
      let newTaxAmt, newTotalAmt;
      if (effectiveTaxInclusive) {
        newTotalAmt = Number((newSubtotal - discountAmt).toFixed(2));
        newTaxAmt = Number((newTotalAmt * (effectiveTaxRate / (100 + effectiveTaxRate))).toFixed(2));
      } else {
        const taxableAmount = Number((newSubtotal - discountAmt).toFixed(2));
        newTaxAmt = Number((taxableAmount * (effectiveTaxRate / 100)).toFixed(2));
        newTotalAmt = Number((taxableAmount + newTaxAmt).toFixed(2));
      }

      // 3. Update order totals and reset station statuses if needed
      const updateData: any = {
        id: orderId,
        subtotal: newSubtotal,
        tax_amount: newTaxAmt,
        total_amount: newTotalAmt,
        updated_at: new Date().toISOString()
      };

      if (!currentOrder.session_id && effectiveSessionId) {
        updateData.session_id = effectiveSessionId;
      }

      // If order was already served/ready, we might need to set it back to preparing
      if (currentOrder.status === 'served' || currentOrder.status === 'ready') {
        updateData.status = 'preparing';
      }

      await apiClient.from('hotel_orders').update(updateData).eq('id', updateData.id || updateData?.id);

      // 4. Insert new items
      const itemTimestamp = new Date().toISOString();
      const newItems = items.map(item => {
        const inferred = inferServiceCategoryStation(item.category);
        const effectiveStation = item.station === 'kitchen' || item.station === 'bar'
          ? item.station
          : (inferred === 'other' ? 'kitchen' : inferred);
        return {
        id: crypto.randomUUID(),
        order_id: orderId,
        service_item_id: item.serviceItemId,
        name: item.name,
        quantity: item.quantity,
        purchase_price: (item as any).purchasePrice || 0,
        unit_price: item.unitPrice,
        total_price: item.quantity * item.unitPrice,
        seat_id: item.seatId || null,
        seat_no: item.seatNo || null,
        payment_group_id: item.paymentGroupId || null,
        notes: item.notes || null,
        status: 'pending',
        item_type: item.category || 'food',
        station: effectiveStation,
        shift_id: (currentOrder as any).shift_id || null,
        created_at: itemTimestamp,
        updated_at: itemTimestamp
      };
      });

      // Inventory is deducted by the database when each new order item row is inserted.
      await Promise.all(
        newItems.map((item) => apiClient.from('hotel_order_items').insert(item))
      );

      // Deduct inventory locally for each new item
      await Promise.all(
        newItems.map((item) => deductLocalInventoryForOrderItem(item))
      );

      return { orderId, additionalSubtotal };
    },
    onSuccess: () => {
// 5. Update UI
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      scheduleHotelOrderSync(true);
      toast.success('Items added to order');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
