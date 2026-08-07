import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient, canUseApiClientSync, isBackendTransientError, safeApiClientCall, setBackendUnreachable } from '@/integrations/supabase/client';
import { getLocalData, saveLocalData } from '@/lib/localDataService';
import { syncService } from '@/lib/syncService';
import { buildSessionSeatChargeMap } from '@/lib/hotelSeatChargeUtils';
import type { HotelOrder, HotelOrderItem, HotelTable, HotelTablePaymentGroup, HotelTableSession, HotelTableSessionSeat } from '@/types/hotel';
import { setHotelTableStatus, releaseHotelTableIfNoActiveOrders } from '@/hooks/useHotelOrders';
import { toast } from 'sonner';
import { getReservationDepositCredit } from '@/lib/hotelReservationUtils';

const DEBUG_EVENT_ENDPOINT = 'http://127.0.0.1:7778/event';

function emitWaiterPosDebugEvent(payload: Record<string, unknown>) {
  try {
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : null;
    if (currentOrigin !== 'http://127.0.0.1:7778') {
      return;
    }

    void fetch(DEBUG_EVENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // Ignore optional debug probe failures.
  }
}

export interface HotelTableSessionSummarySeat {
  seat_id: string;
  seat_no: number;
  guest_name: string | null;
  status: string;
  payment_status: string;
  item_total: number;
  total_paid: number;
  outstanding_amount: number;
  payment_group_id: string | null;
  payment_group_name: string | null;
}

export interface HotelTableSessionSummaryGroup {
  payment_group_id: string;
  group_name: string;
  status: string;
  payment_status: string;
  total_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  seat_ids: string[];
  seat_numbers: number[];
}

export interface HotelTableSessionSummary {
  session_id: string;
  table_id: string;
  table_number: string | null;
  guest_count: number;
  status: string;
  payment_status: string;
  opened_at: string;
  opened_by: string | null;
  opened_shift_id: string | null;
  subtotal: number;
  tax_amount: number;
  tax_rate: number;
  deposit_credit_total: number;
  total_amount: number;
  total_paid: number;
  outstanding_amount: number;
  seats: HotelTableSessionSummarySeat[];
  groups: HotelTableSessionSummaryGroup[];
}

export interface HotelTableSessionBillingItem {
  item_id: string;
  order_id: string;
  order_number: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  customer_tin?: string | null;
  seat_id: string | null;
  seat_no: number | null;
  payment_group_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  status: string;
  notes: string | null;
  created_at: string;
}

type ActiveSessionRecord = HotelTableSession & {
  seats?: HotelTableSessionSeat[];
  opener?: { id: string; first_name: string; last_name: string; role: string } | null;
};

type ActiveSessionWithSummary = ActiveSessionRecord & {
  total_amount?: number;
  total_paid?: number;
  outstanding_amount?: number;
  groups?: HotelTableSessionSummaryGroup[];
  is_fallback_session?: boolean;
};

type LocalTablePaymentRecord = {
  id: string;
  session_id?: string | null;
  seat_id?: string | null;
  payment_group_id?: string | null;
  payment_method?: string | null;
  amount?: number | null;
  status?: string | null;
  receipt_no?: string | null;
  staff_id?: string | null;
  shift_id?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

type LocalTablePaymentGroupSeatRecord = {
  id: string;
  payment_group_id: string;
  seat_id: string;
  created_at?: string;
};
// RWF (and similar) has no sub-unit — treat any gap under 1 currency unit
// between what's owed and what's paid as fully settled. Comparing raw
// unrounded totalPaid/itemTotal directly causes a seat to get stuck in
// 'partial' forever whenever the two independent rounding paths (pay-time
// tax calc vs. summary-time proportional allocation) land a fraction of a
// unit apart, even though the displayed "Remaining" already rounds to 0.
const SEAT_BALANCE_EPSILON = 1;

const ACTIVE_SESSION_STATUSES = ['active', 'partially_paid'];
const EXCLUDED_PAYMENT_STATUSES = ['void', 'refunded'];
const FALLBACK_ACTIVE_ORDER_STATUSES = ['pending', 'preparing', 'ready', 'served', 'awaiting_approval', 'pending_handover', 'billed'];
const FALLBACK_SESSION_PREFIX = 'fallback-session:';

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function getSessionReservationDepositTotal(
  orders: Array<Pick<HotelOrder, 'deposit_amount' | 'checked_in_at' | 'total_amount'>>
) {
  return roundMoney(
    orders.reduce(
      (sum, order) => sum + getReservationDepositCredit(order, { requireCheckIn: true }),
      0
    )
  );
}

function normalizeTableNumber(value?: string | null) {
  return (value || '').trim().toUpperCase();
}

function buildTableReferenceKey(tableId?: string | null, tableNumber?: string | null) {
  const normalizedNumber = normalizeTableNumber(tableNumber);
  return tableId ? `id:${tableId}` : normalizedNumber ? `num:${normalizedNumber}` : null;
}

function buildFallbackSessionId(tableId?: string | null, tableNumber?: string | null) {
  return `${FALLBACK_SESSION_PREFIX}${tableId || ''}::${encodeURIComponent(tableNumber || '')}`;
}

function isFallbackSessionId(sessionId?: string | null) {
  return !!sessionId && sessionId.startsWith(FALLBACK_SESSION_PREFIX);
}

/**
 * Parses a fallback session ID and returns { tableId, tableNumber }.
 * Format: "fallback-session:{tableId}::{encodedTableNumber}"
 */
function parseFallbackSessionId(sessionId: string): { tableId: string | null; tableNumber: string | null } {
  const stripped = sessionId.slice(FALLBACK_SESSION_PREFIX.length);
  const separatorIndex = stripped.indexOf('::');
  if (separatorIndex === -1) return { tableId: null, tableNumber: null };
  const tableId = stripped.slice(0, separatorIndex) || null;
  const tableNumber = decodeURIComponent(stripped.slice(separatorIndex + 2)) || null;
  return { tableId, tableNumber };
}

function buildSessionSeatMaps(
  sessionSeats: Array<
    | Pick<HotelTableSessionSeat, 'id' | 'seat_no'>
    | Pick<HotelTableSessionSummarySeat, 'seat_id' | 'seat_no'>
  >
) {
  const seatIdBySeatNo = new Map<number, string>();
  const seatNoBySeatId = new Map<string, number>();

  sessionSeats.forEach((seat) => {
    const seatId = 'seat_id' in seat ? seat.seat_id : seat.id;
    seatIdBySeatNo.set(Number(seat.seat_no), seatId);
    seatNoBySeatId.set(seatId, Number(seat.seat_no));
  });

  return { seatIdBySeatNo, seatNoBySeatId };
}

function resolveSessionSeatId(
  sessionSeats: Array<
    | Pick<HotelTableSessionSeat, 'id' | 'seat_no'>
    | Pick<HotelTableSessionSummarySeat, 'seat_id' | 'seat_no'>
  >,
  rawSeatId?: string | null,
  rawSeatNo?: number | null,
  fallbackSeatId?: string | null
) {
  const { seatIdBySeatNo, seatNoBySeatId } = buildSessionSeatMaps(sessionSeats);

  if (rawSeatId && seatNoBySeatId.has(rawSeatId)) {
    return rawSeatId;
  }

  const numericSeatNo = Number(rawSeatNo || 0);
  if (numericSeatNo > 0) {
    return seatIdBySeatNo.get(numericSeatNo) || null;
  }

  if (fallbackSeatId && seatNoBySeatId.has(fallbackSeatId)) {
    return fallbackSeatId;
  }

  return null;
}

function resolveSessionSeatNo(
  sessionSeats: Array<
    | Pick<HotelTableSessionSeat, 'id' | 'seat_no'>
    | Pick<HotelTableSessionSummarySeat, 'seat_id' | 'seat_no'>
  >,
  rawSeatId?: string | null,
  rawSeatNo?: number | null
) {
  const numericSeatNo = Number(rawSeatNo || 0);
  if (numericSeatNo > 0) {
    return numericSeatNo;
  }

  if (!rawSeatId) {
    return null;
  }

  const { seatNoBySeatId } = buildSessionSeatMaps(sessionSeats);
  return seatNoBySeatId.get(rawSeatId) || null;
}

function getFallbackSeatCount(orders: Array<Partial<HotelOrder>>) {
  const seatNumbers = new Set<number>();

  orders.forEach((order) => {
    const orderSeatNo = Number((order as any).seat_no || 0);
    if (orderSeatNo > 0) {
      seatNumbers.add(orderSeatNo);
    }

    (order.items || []).forEach((item) => {
      const seatNo = Number(item.seat_no || 0);
      if (seatNo > 0) {
        seatNumbers.add(seatNo);
      }
    });
  });

  return Math.max(seatNumbers.size, 1);
}

function buildFallbackActiveSessionsFromOrders(params: {
  orders: Array<Partial<HotelOrder> & {
    waiter?: { id: string; first_name: string; last_name: string; role: string } | null;
    table?: { id: string; table_number: string; name: string | null; status: string } | null;
  }>;
  tables: HotelTable[];
  staff: Array<{ id: string; first_name: string; last_name: string; role: string }>;
  existingSessions: Array<Pick<HotelTableSession, 'table_id' | 'table_number'>>;
}) {
  const existingSessionKeys = new Set(
    params.existingSessions
      .map((session) => buildTableReferenceKey(session.table_id, session.table_number))
      .filter((value): value is string => !!value)
  );
  const ordersByTableKey = new Map<
    string,
    Array<Partial<HotelOrder> & {
      waiter?: { id: string; first_name: string; last_name: string; role: string } | null;
      table?: { id: string; table_number: string; name: string | null; status: string } | null;
    }>
  >();

  params.orders
    .filter((order) =>
      FALLBACK_ACTIVE_ORDER_STATUSES.includes(String(order.status || '')) &&
      !!buildTableReferenceKey(order.table_id, order.table_number)
    )
    .forEach((order) => {
      const tableKey = buildTableReferenceKey(order.table_id, order.table_number);
      if (!tableKey || existingSessionKeys.has(tableKey)) {
        return;
      }

      const bucket = ordersByTableKey.get(tableKey) || [];
      bucket.push(order);
      ordersByTableKey.set(tableKey, bucket);
    });

  return Array.from(ordersByTableKey.entries()).map(([tableKey, tableOrders]) => {
    const sortedOrders = [...tableOrders].sort(
      (left, right) => new Date(left.created_at || new Date(0).toISOString()).getTime() - new Date(right.created_at || new Date(0).toISOString()).getTime()
    );
    const firstOrder = sortedOrders[0];
    const lastUpdatedOrder = [...tableOrders].sort(
      (left, right) => new Date(right.updated_at || right.created_at || new Date(0).toISOString()).getTime() - new Date(left.updated_at || left.created_at || new Date(0).toISOString()).getTime()
    )[0];
    const table =
      firstOrder.table ||
      (firstOrder.table_id
        ? params.tables.find((entry) => entry.id === firstOrder.table_id) || null
        : params.tables.find((entry) => normalizeTableNumber(entry.table_number) === normalizeTableNumber(firstOrder.table_number)) || null);
    const opener =
      firstOrder.waiter ||
      (firstOrder.waiter_id || firstOrder.staff_id
        ? params.staff.find((entry) => entry.id === (firstOrder.waiter_id || firstOrder.staff_id)) || null
        : null);
    const tableId =
      firstOrder.table_id ||
      table?.id ||
      `synthetic-table:${normalizeTableNumber(firstOrder.table_number) || tableKey.replace(':', '-')}`;
    const tableNumber = firstOrder.table_number || table?.table_number || null;
    const seatCount = getFallbackSeatCount(tableOrders);
    const totalAmount = roundMoney(
      tableOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
    );
    const openedAt = firstOrder.created_at || new Date().toISOString();
    const updatedAt = lastUpdatedOrder.updated_at || lastUpdatedOrder.created_at || openedAt;

    return {
      id: buildFallbackSessionId(tableId, tableNumber),
      table_id: tableId,
      table_number: tableNumber,
      guest_count: seatCount,
      opened_by: firstOrder.waiter_id || firstOrder.staff_id || null,
      opened_shift_id: firstOrder.shift_id || null,
      status: 'active',
      payment_status: 'pending',
      notes: 'Derived from occupied table orders while no persisted table session is available yet.',
      opened_at: openedAt,
      closed_at: null,
      created_at: openedAt,
      updated_at: updatedAt,
      seats: Array.from({ length: seatCount }, (_, index) => ({
        id: `${buildFallbackSessionId(tableId, tableNumber)}:seat:${index + 1}`,
        session_id: buildFallbackSessionId(tableId, tableNumber),
        seat_no: index + 1,
        guest_name: null,
        status: 'active',
        payment_status: 'pending',
        paid_at: null,
        created_at: openedAt,
        updated_at: updatedAt,
      })),
      groups: [],
      total_amount: totalAmount,
      total_paid: 0,
      outstanding_amount: totalAmount,
      table: table
        ? table
        : {
            id: tableId,
            table_number: tableNumber || 'Table',
            name: null,
            status: 'occupied',
          },
      opener,
      is_fallback_session: true,
    } satisfies ActiveSessionWithSummary & {
      table?: { id: string; table_number: string; name: string | null; status: string } | null;
    };
  });
}

function allocateGroupPaymentAcrossSeats(
  seatIds: string[],
  itemTotalBySeatId: Map<string, number>,
  groupPaidAmount: number
) {
  const allocations = new Map<string, number>();
  const normalizedPaidAmount = roundMoney(Math.max(Number(groupPaidAmount || 0), 0));
  const payableSeatIds = seatIds.filter((seatId) => Number(itemTotalBySeatId.get(seatId) || 0) > 0);
  const groupTotalAmount = roundMoney(
    payableSeatIds.reduce((sum, seatId) => sum + Number(itemTotalBySeatId.get(seatId) || 0), 0)
  );

  if (normalizedPaidAmount <= 0 || groupTotalAmount <= 0 || payableSeatIds.length === 0) {
    return allocations;
  }

  let remainingAmount = Math.min(normalizedPaidAmount, groupTotalAmount);

  payableSeatIds.forEach((seatId, index) => {
    const seatTotal = roundMoney(Number(itemTotalBySeatId.get(seatId) || 0));
    if (seatTotal <= 0) {
      return;
    }

    const isLastSeat = index === payableSeatIds.length - 1;
    const proportionalShare = isLastSeat
      ? remainingAmount
      : roundMoney((normalizedPaidAmount * seatTotal) / groupTotalAmount);
    const allocatedAmount = roundMoney(Math.min(seatTotal, Math.max(Math.min(proportionalShare, remainingAmount), 0)));

    allocations.set(seatId, allocatedAmount);
    remainingAmount = roundMoney(Math.max(remainingAmount - allocatedAmount, 0));
  });

  return allocations;
}

async function loadLocalTableSessionState(sessionId: string) {
  const [sessions, seats, groups, groupSeats, payments, orders, items, tables] = await Promise.all([
    getLocalData<HotelTableSession>('hotel_table_sessions'),
    getLocalData<HotelTableSessionSeat>('hotel_table_session_seats'),
    getLocalData<HotelTablePaymentGroup>('hotel_table_payment_groups'),
    getLocalData<LocalTablePaymentGroupSeatRecord>('hotel_table_payment_group_seats'),
    getLocalData<LocalTablePaymentRecord>('hotel_payments'),
    getLocalData<HotelOrder>('hotel_orders'),
    getLocalData<HotelOrderItem>('hotel_order_items'),
    getLocalData<HotelTable>('hotel_tables'),
  ]);

  const session = (sessions || []).find((entry) => entry.id === sessionId) || null;
  const sessionSeats = (seats || []).filter((entry) => entry.session_id === sessionId);
  const sessionGroups = (groups || []).filter((entry) => entry.session_id === sessionId);
  const groupIds = new Set(sessionGroups.map((entry) => entry.id));
  const sessionGroupSeats = (groupSeats || []).filter((entry) => groupIds.has(entry.payment_group_id));
  const sessionPayments = (payments || []).filter((entry) => entry.session_id === sessionId);

  // Link orders to session using either session_id directly OR table_id + active status if session_id is missing
  const sessionOrders = session ? resolveLocalSessionOrders(sessionId, session, orders || []) : [];

  const orderIds = new Set(sessionOrders.map((entry) => entry.id));
  const sessionItems = (items || []).filter((entry) => orderIds.has(entry.order_id));
  const table = session?.table_id ? (tables || []).find((entry) => entry.id === session.table_id) || null : null;

  return {
    session,
    seats: sessionSeats,
    groups: sessionGroups,
    groupSeats: sessionGroupSeats,
    payments: sessionPayments,
    orders: sessionOrders,
    items: sessionItems,
    table,
  };
}

const isTableOccupyingOrderStatus = (status: string) =>
  ['pending', 'preparing', 'ready', 'served', 'awaiting_approval', 'pending_handover', 'billed'].includes(status);

function resolveLocalSessionOrders(
  sessionId: string,
  session: HotelTableSession | null,
  orders: HotelOrder[]
) {
  // Strict match only. Do NOT fall back to "same table_id + null session_id",
  // since that silently re-merges deliberately standalone orders (a second,
  // separate customer on the same table created via handleCreateNewOrder's
  // `standalone: true` path) back into this session — which inflates the
  // session/seat totals and breaks split-bill payments (RPC rejects the
  // amount because the "outstanding seat balance" includes the other
  // customer's unrelated order).
  return (orders || []).filter((order) => order.session_id === sessionId);
}
// ---------------------------------------------------------------------------
// NEW: Build a session summary directly from orders for fallback session IDs
// ---------------------------------------------------------------------------
async function buildFallbackSessionSummary(
  sessionId: string
): Promise<HotelTableSessionSummary | null> {
  const { tableId, tableNumber } = parseFallbackSessionId(sessionId);

  const [orders, items, tables, localPayments, hotelInfoData] = await Promise.all([
    getLocalData<HotelOrder>('hotel_orders'),
    getLocalData<HotelOrderItem>('hotel_order_items'),
    getLocalData<HotelTable>('hotel_tables'),
    getLocalData<LocalTablePaymentRecord>('hotel_payments'),
    getLocalData<any>('hotel_info'),
  ]);

  const taxRate = hotelInfoData?.[0]?.tax_rate ?? 18;

  const table = tableId
    ? (tables || []).find((t) => t.id === tableId) || null
    : null;

  const sessionOrders = (orders || []).filter(
    (o) =>
      FALLBACK_ACTIVE_ORDER_STATUSES.includes(String(o.status || '')) &&
      (tableId
        ? o.table_id === tableId
        : normalizeTableNumber(o.table_number) === normalizeTableNumber(tableNumber))
  );

  if (sessionOrders.length === 0) return null;

  const validPayments = (localPayments || []).filter(
    (entry) => 
      entry.session_id === sessionId && 
      !EXCLUDED_PAYMENT_STATUSES.includes((entry.status || 'posted').toLowerCase())
  );

  const orderIds = new Set(sessionOrders.map((o) => o.id));
  const sessionItems = (items || []).filter(
    (i) => orderIds.has(i.order_id) && i.status !== 'cancelled'
  );

  const seatCount = getFallbackSeatCount(sessionOrders);

  // Build synthetic seats
  const syntheticSeats = Array.from({ length: seatCount }, (_, index) => ({
    id: `${sessionId}:seat:${index + 1}`,
    seat_no: index + 1,
  }));

  const seatChargeBySeatId = buildSessionSeatChargeMap({
    orders: sessionOrders,
    items: sessionItems,
    sessionSeats: syntheticSeats,
    fallbackSeatId: syntheticSeats[0]?.id || null,
  });

  const seats: HotelTableSessionSummarySeat[] = syntheticSeats.map((seat) => {
    const itemTotal = roundMoney(seatChargeBySeatId.get(seat.id)?.total || 0);
    const seatPayments = validPayments
      .filter((p) => p.seat_id === seat.id)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
      
    const totalPaid = roundMoney(Math.min(itemTotal, seatPayments));
    const outstanding = roundMoney(Math.max(itemTotal - totalPaid, 0));

   const outstandingAmount = outstanding <= SEAT_BALANCE_EPSILON ? 0 : outstanding;
    return {
      seat_id: seat.id,
      seat_no: seat.seat_no,
      guest_name: null,
      status: 'active',
      payment_status: itemTotal <= 0 ? 'paid' : outstandingAmount <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'pending',
      item_total: itemTotal,
      total_paid: totalPaid,
      outstanding_amount: outstandingAmount,
      payment_group_id: null,
      payment_group_name: null,
    };
  });

  const subtotal = roundMoney(sessionOrders.reduce((sum, order) => sum + Number(order.subtotal || 0), 0));
  const taxAmount = roundMoney(sessionOrders.reduce((sum, order) => sum + Number(order.tax_amount || 0), 0));
  const totalAmount = roundMoney(sessionOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0));
  const depositCreditTotal = getSessionReservationDepositTotal(sessionOrders);

  const totalPaid = roundMoney(validPayments.reduce((s, p) => s + Number(p.amount || 0), 0));
  const outstandingAmount = roundMoney(Math.max(totalAmount - depositCreditTotal - totalPaid, 0));
  const paymentStatus = outstandingAmount <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'pending';

  const firstOrder = sessionOrders.sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  )[0];

  return {
    session_id: sessionId,
    table_id: tableId || '',
    table_number: tableNumber || table?.table_number || null,
    guest_count: seatCount,
    status: outstandingAmount <= 0 ? 'closed' : 'active',
    payment_status: paymentStatus,
    opened_at: firstOrder.created_at || new Date().toISOString(),
    opened_by: firstOrder.waiter_id || firstOrder.staff_id || null,
    opened_shift_id: firstOrder.shift_id || null,
    subtotal,
    tax_amount: taxAmount,
    tax_rate: taxRate,
    deposit_credit_total: depositCreditTotal,
    total_amount: totalAmount,
    total_paid: totalPaid,
    outstanding_amount: outstandingAmount,
    seats,
    groups: [],
  };
}

// ---------------------------------------------------------------------------
// NEW: Load billing items directly from orders for fallback session IDs
// ---------------------------------------------------------------------------
async function loadFallbackSessionBillingItems(
  sessionId: string
): Promise<HotelTableSessionBillingItem[]> {
  const { tableId, tableNumber } = parseFallbackSessionId(sessionId);

  const [orders, items] = await Promise.all([
    getLocalData<HotelOrder>('hotel_orders'),
    getLocalData<HotelOrderItem>('hotel_order_items'),
  ]);

  const sessionOrders = (orders || []).filter(
    (o) =>
      FALLBACK_ACTIVE_ORDER_STATUSES.includes(String(o.status || '')) &&
      (tableId
        ? o.table_id === tableId
        : normalizeTableNumber(o.table_number) === normalizeTableNumber(tableNumber))
  );

  if (sessionOrders.length === 0) return [];

  const orderMap = new Map(sessionOrders.map((o) => [o.id, o]));
  const seatCount = getFallbackSeatCount(sessionOrders);

  // Build synthetic seat maps for resolution
  const syntheticSeats = Array.from({ length: seatCount }, (_, i) => ({
    id: `${sessionId}:seat:${i + 1}`,
    seat_no: i + 1,
  }));

  return (items || [])
    .filter((item) => orderMap.has(item.order_id))
    .map((item) => {
      const order = orderMap.get(item.order_id)!;
      const resolvedSeatId = resolveSessionSeatId(
        syntheticSeats,
        item.seat_id || order.seat_id || null,
        item.seat_no || null,
        syntheticSeats[0]?.id
      );
      const resolvedSeatNo = resolveSessionSeatNo(
        syntheticSeats,
        item.seat_id || order.seat_id || null,
        item.seat_no || null
      );

      return {
        item_id: item.id,
        order_id: item.order_id,
        order_number: order.order_number,
        customer_id: order.customer_id || null,
        customer_name: order.customer_name || null,
        customer_phone: order.customer_phone || null,
        customer_email: order.customer_email || null,
        customer_address: order.customer_address || null,
        customer_tin: order.customer_tin || null,
        seat_id: resolvedSeatId,
        seat_no: resolvedSeatNo,
        payment_group_id: item.payment_group_id || null,
        name: item.name,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0),
        status: item.status,
        notes: item.notes || null,
        created_at: item.created_at,
      } satisfies HotelTableSessionBillingItem;
    })
    .sort((a, b) => {
      const seatDiff = Number(a.seat_no || 0) - Number(b.seat_no || 0);
      if (seatDiff !== 0) return seatDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
}

async function buildOrphanSessionSummary(
  sessionId: string
): Promise<HotelTableSessionSummary | null> {
  const [orders, items, tables, localSeats, hotelInfoData] = await Promise.all([
    getLocalData<HotelOrder>('hotel_orders'),
    getLocalData<HotelOrderItem>('hotel_order_items'),
    getLocalData<HotelTable>('hotel_tables'),
    getLocalData<HotelTableSessionSeat>('hotel_table_session_seats'),
    getLocalData<any>('hotel_info'),
  ]);

  const taxRate = hotelInfoData?.[0]?.tax_rate ?? 18;

  const sessionOrders = (orders || []).filter(
    (order) =>
      order.session_id === sessionId &&
      FALLBACK_ACTIVE_ORDER_STATUSES.includes(String(order.status || ''))
  );

  if (sessionOrders.length === 0) {
    return null;
  }

  const firstOrder = [...sessionOrders].sort(
    (left, right) =>
      new Date(left.created_at || new Date(0).toISOString()).getTime() -
      new Date(right.created_at || new Date(0).toISOString()).getTime()
  )[0];
  const sessionItems = (items || []).filter(
    (item) =>
      sessionOrders.some((order) => order.id === item.order_id) &&
      item.status !== 'cancelled'
  );
  const persistedSeats = (localSeats || [])
    .filter((seat) => seat.session_id === sessionId)
    .sort((left, right) => left.seat_no - right.seat_no);

  const fallbackSeatCount = Math.max(
    persistedSeats.length,
    getFallbackSeatCount(sessionOrders),
    1
  );
  const syntheticSeats = Array.from({ length: fallbackSeatCount }, (_, index) => ({
    id: `${sessionId}:seat:${index + 1}`,
    seat_no: index + 1,
    guest_name: null,
    status: 'active' as const,
    payment_status: 'pending' as const,
    paid_at: null,
    created_at: firstOrder.created_at || new Date().toISOString(),
    updated_at: firstOrder.updated_at || firstOrder.created_at || new Date().toISOString(),
  }));
  const resolvedSeats = persistedSeats.length > 0 ? persistedSeats : syntheticSeats;
  const seatChargeBySeatId = buildSessionSeatChargeMap({
    orders: sessionOrders,
    items: sessionItems,
    sessionSeats: resolvedSeats,
    fallbackSeatId: resolvedSeats[0]?.id || null,
  });

  const seats: HotelTableSessionSummarySeat[] = resolvedSeats.map((seat) => {
    const itemTotal = roundMoney(seatChargeBySeatId.get(seat.id)?.total || 0);
    return {
      seat_id: seat.id,
      seat_no: seat.seat_no,
      guest_name: seat.guest_name || null,
      status: seat.status,
      payment_status: itemTotal <= 0 ? 'paid' : 'pending',
      item_total: itemTotal,
      total_paid: 0,
      outstanding_amount: itemTotal,
      payment_group_id: null,
      payment_group_name: null,
    };
  });

  const subtotal = roundMoney(sessionOrders.reduce((sum, order) => sum + Number(order.subtotal || 0), 0));
  const taxAmount = roundMoney(sessionOrders.reduce((sum, order) => sum + Number(order.tax_amount || 0), 0));
  const totalAmount = roundMoney(sessionOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0));
  const depositCreditTotal = getSessionReservationDepositTotal(sessionOrders);

  const table = firstOrder.table_id
    ? (tables || []).find((entry) => entry.id === firstOrder.table_id) || null
    : (tables || []).find(
        (entry) => normalizeTableNumber(entry.table_number) === normalizeTableNumber(firstOrder.table_number)
      ) || null;

  return {
    session_id: sessionId,
    table_id: firstOrder.table_id || table?.id || '',
    table_number: firstOrder.table_number || table?.table_number || null,
    guest_count: resolvedSeats.length,
    status: 'active',
    payment_status: 'pending',
    opened_at: firstOrder.created_at || new Date().toISOString(),
    opened_by: firstOrder.waiter_id || firstOrder.staff_id || null,
    opened_shift_id: firstOrder.shift_id || null,
    subtotal,
    tax_amount: taxAmount,
    tax_rate: taxRate,
    deposit_credit_total: depositCreditTotal,
    total_amount: totalAmount,
    total_paid: 0,
    outstanding_amount: roundMoney(Math.max(totalAmount - depositCreditTotal, 0)),
    seats,
    groups: [],
  };
}

async function loadOrphanSessionBillingItems(
  sessionId: string
): Promise<HotelTableSessionBillingItem[]> {
  const [orders, items, localSeats] = await Promise.all([
    getLocalData<HotelOrder>('hotel_orders'),
    getLocalData<HotelOrderItem>('hotel_order_items'),
    getLocalData<HotelTableSessionSeat>('hotel_table_session_seats'),
  ]);

  const sessionOrders = (orders || []).filter(
    (order) =>
      order.session_id === sessionId &&
      FALLBACK_ACTIVE_ORDER_STATUSES.includes(String(order.status || ''))
  );

  if (sessionOrders.length === 0) {
    return [];
  }

  const persistedSeats = (localSeats || [])
    .filter((seat) => seat.session_id === sessionId)
    .sort((left, right) => left.seat_no - right.seat_no);
  const fallbackSeatCount = Math.max(
    persistedSeats.length,
    getFallbackSeatCount(sessionOrders),
    1
  );
  const syntheticSeats = Array.from({ length: fallbackSeatCount }, (_, index) => ({
    id: `${sessionId}:seat:${index + 1}`,
    seat_no: index + 1,
  }));
  const resolvedSeats = persistedSeats.length > 0 ? persistedSeats : syntheticSeats;
  const firstSeat = resolvedSeats[0];
  const orderMap = new Map(sessionOrders.map((order) => [order.id, order]));

  return (items || [])
    .filter((item) => orderMap.has(item.order_id))
    .map((item) => {
      const order = orderMap.get(item.order_id)!;
      const resolvedSeatId = resolveSessionSeatId(
        resolvedSeats,
        item.seat_id || order.seat_id || null,
        item.seat_no || null,
        firstSeat?.id
      );
      const resolvedSeatNo = resolveSessionSeatNo(
        resolvedSeats,
        item.seat_id || order.seat_id || null,
        item.seat_no || null
      );

      return {
        item_id: item.id,
        order_id: item.order_id,
        order_number: order.order_number,
        customer_id: order.customer_id || null,
        customer_name: order.customer_name || null,
        customer_phone: order.customer_phone || null,
        customer_email: order.customer_email || null,
        customer_address: order.customer_address || null,
        customer_tin: order.customer_tin || null,
        seat_id: resolvedSeatId,
        seat_no: resolvedSeatNo,
        payment_group_id: item.payment_group_id || null,
        name: item.name,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0),
        status: item.status,
        notes: item.notes || null,
        created_at: item.created_at,
      } satisfies HotelTableSessionBillingItem;
    })
    .sort((left, right) => {
      const seatDiff = Number(left.seat_no || 0) - Number(right.seat_no || 0);
      if (seatDiff !== 0) return seatDiff;
      return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    });
}

async function buildLocalTableSessionSummary(sessionId?: string | null) {
  if (!sessionId) return null;

  // FIX: Fallback sessions don't exist in IndexedDB — resolve from orders directly
  if (isFallbackSessionId(sessionId)) {
    return buildFallbackSessionSummary(sessionId);
  }

  const [state, hotelInfoData] = await Promise.all([
    loadLocalTableSessionState(sessionId),
    getLocalData<any>('hotel_info'),
  ]);
  if (!state.session) {
    return buildOrphanSessionSummary(sessionId);
  }

  const taxRate = hotelInfoData?.[0]?.tax_rate ?? 18;

  const validPayments = state.payments.filter(
    (entry) => !EXCLUDED_PAYMENT_STATUSES.includes((entry.status || 'posted').toLowerCase())
  );

  const sortedSeats = [...state.seats].sort((a, b) => a.seat_no - b.seat_no);
  const seatChargeBySeatId = buildSessionSeatChargeMap({
    orders: state.orders,
    items: state.items.filter((entry) => entry.status !== 'cancelled'),
    sessionSeats: sortedSeats,
    fallbackSeatId: sortedSeats[0]?.id || null,
  });

  const seatIdsByGroupId = new Map<string, string[]>();
  const groupBySeatId = new Map<string, HotelTablePaymentGroup>();
  state.groupSeats.forEach((entry) => {
    const current = seatIdsByGroupId.get(entry.payment_group_id) || [];
    current.push(entry.seat_id);
    seatIdsByGroupId.set(entry.payment_group_id, current);

    const group = state.groups.find((candidate) => candidate.id === entry.payment_group_id);
    if (group && group.status !== 'cancelled') {
      groupBySeatId.set(entry.seat_id, group);
    }
  });

  const groupPaidBySeatId = new Map<string, number>();

  const groups: HotelTableSessionSummaryGroup[] = state.groups.map((group) => {
    const seatIds = seatIdsByGroupId.get(group.id) || [];
    const seatNumbers = state.seats
      .filter((seat) => seatIds.includes(seat.id))
      .map((seat) => seat.seat_no)
      .sort((left, right) => left - right);
    const totalAmount = Number(
      seatIds.reduce((sum, seatId) => sum + Number(seatChargeBySeatId.get(seatId)?.total || 0), 0).toFixed(2)
    );
    const paidAmount = Number(
      validPayments
        .filter((entry) => entry.payment_group_id === group.id)
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
        .toFixed(2)
    );
    const paymentStatus =
      totalAmount <= 0 ? 'paid' : paidAmount >= totalAmount ? 'paid' : paidAmount > 0 ? 'partial' : 'pending';

    const groupChargeTotals = new Map(
      seatIds.map((seatId) => [seatId, Number(seatChargeBySeatId.get(seatId)?.total || 0)])
    );
    const seatPaymentAllocations = allocateGroupPaymentAcrossSeats(seatIds, groupChargeTotals, paidAmount);
    seatPaymentAllocations.forEach((allocatedAmount, seatId) => {
      groupPaidBySeatId.set(seatId, roundMoney(Number(groupPaidBySeatId.get(seatId) || 0) + allocatedAmount));
    });

    return {
      payment_group_id: group.id,
      group_name: group.group_name,
      status: group.status,
      payment_status: paymentStatus,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      outstanding_amount: Number(Math.max(totalAmount - paidAmount, 0).toFixed(2)),
      seat_ids: seatIds,
      seat_numbers: seatNumbers,
    };
  });

  const groupSummaryById = new Map(groups.map((entry) => [entry.payment_group_id, entry]));

  const seats: HotelTableSessionSummarySeat[] = state.seats
    .sort((left, right) => left.seat_no - right.seat_no)
    .map((seat) => {
      const directPaid = Number(
        validPayments
          .filter((entry) => entry.seat_id === seat.id)
          .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
          .toFixed(2)
      );
      const itemTotal = Number(seatChargeBySeatId.get(seat.id)?.total || 0);
      const groupedPaid = roundMoney(Number(groupPaidBySeatId.get(seat.id) || 0));
      const linkedGroup = groupBySeatId.get(seat.id) || null;
      const linkedGroupSummary = linkedGroup ? groupSummaryById.get(linkedGroup.id) || null : null;
     
  const totalPaid = roundMoney(Math.min(itemTotal, directPaid + groupedPaid));
      const rawOutstanding = roundMoney(Math.max(itemTotal - totalPaid, 0));
      // Collapse to zero (and therefore 'paid') once the gap is inside the
      // rounding tolerance — this must use the SAME threshold as what's
      // shown on screen, or the badge and the button disagree forever.
      const outstandingAmount = rawOutstanding <= SEAT_BALANCE_EPSILON ? 0 : rawOutstanding;
      const paymentStatus =
        itemTotal <= 0
          ? 'paid'
          : outstandingAmount <= 0
            ? 'paid'
            : totalPaid > 0
              ? 'partial'
              : 'pending';

      return {
        seat_id: seat.id,
        seat_no: seat.seat_no,
        guest_name: seat.guest_name,
        status: seat.status,
        payment_status: paymentStatus,
        item_total: roundMoney(itemTotal),
        total_paid: totalPaid,
        outstanding_amount: outstandingAmount,
        payment_group_id: linkedGroupSummary?.payment_group_id || null,
        payment_group_name: linkedGroupSummary?.group_name || null,
      };

    });

  const subtotal = roundMoney(state.orders.reduce((sum, order) => sum + Number(order.subtotal || 0), 0));
  const taxAmount = roundMoney(state.orders.reduce((sum, order) => sum + Number(order.tax_amount || 0), 0));
  const totalAmount = roundMoney(state.orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0));
  const depositCreditTotal = getSessionReservationDepositTotal(state.orders);

  const totalPaid = Number(validPayments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0).toFixed(2));
  const allPaid = seats.length > 0 && seats.every((seat) => seat.payment_status === 'paid');
  const anyPaid = seats.some((seat) => ['partial', 'paid'].includes(seat.payment_status));

  return {
    session_id: state.session.id,
    table_id: state.session.table_id,
    table_number: state.session.table_number,
    guest_count: state.session.guest_count,
    status: allPaid ? 'closed' : anyPaid ? 'partially_paid' : 'active',
    payment_status: allPaid ? 'paid' : anyPaid ? 'partial' : 'pending',
    opened_at: state.session.opened_at,
    opened_by: state.session.opened_by,
    opened_shift_id: state.session.opened_shift_id,
    subtotal,
    tax_amount: taxAmount,
    tax_rate: taxRate,
    deposit_credit_total: depositCreditTotal,
    total_amount: totalAmount,
    total_paid: totalPaid,
    outstanding_amount: Number(Math.max(totalAmount - depositCreditTotal - totalPaid, 0).toFixed(2)),
    seats,
    groups,
  } satisfies HotelTableSessionSummary;
}

async function refreshLocalTableSessionState(sessionId: string) {
  const state = await loadLocalTableSessionState(sessionId);
  const summary = await buildLocalTableSessionSummary(sessionId);

  if (!state.session || !summary) {
    return null;
  }

  const now = new Date().toISOString();
  const groupSummaryById = new Map(summary.groups.map((entry) => [entry.payment_group_id, entry]));
  const seatSummaryById = new Map(summary.seats.map((entry) => [entry.seat_id, entry]));

  await Promise.all(
    state.groups.map(async (group) => {
      const next = groupSummaryById.get(group.id);
      if (!next) return;

      await syncService.performOperation('hotel_table_payment_groups', 'update', {
        id: group.id,
        total_amount: next.total_amount,
        paid_amount: next.paid_amount,
        payment_status: next.payment_status,
        status: group.status === 'cancelled' ? 'cancelled' : next.payment_status === 'paid' ? 'closed' : 'active',
        updated_at: now,
      });
    })
  );

  await Promise.all(
    state.seats.map(async (seat) => {
      const next = seatSummaryById.get(seat.id);
      if (!next) return;

      await syncService.performOperation('hotel_table_session_seats', 'update', {
        id: seat.id,
        payment_status: next.payment_status,
        paid_at: next.payment_status === 'paid' ? seat.paid_at || now : null,
        updated_at: now,
      });
    })
  );

  await syncService.performOperation('hotel_table_sessions', 'update', {
    id: state.session.id,
    status: summary.status,
    payment_status: summary.payment_status,
    closed_at: summary.payment_status === 'paid' ? state.session.closed_at || now : null,
    updated_at: now,
  });

  if (state.session.table_id) {
    await syncService.performOperation('hotel_tables', 'update', {
      id: state.session.table_id,
      status: summary.payment_status === 'paid' ? 'free' : 'occupied',
      updated_at: now,
    });
  }

  return summary;
}

async function openLocalTableSession(params: {
  tableId: string;
  guestCount: number;
  openedBy?: string | null;
  openedShiftId?: string | null;
  notes?: string | null;
}) {
  const now = new Date().toISOString();
  const tables = await getLocalData<HotelTable>('hotel_tables');
  const sessions = await getLocalData<HotelTableSession>('hotel_table_sessions');
  const seats = await getLocalData<HotelTableSessionSeat>('hotel_table_session_seats');
  const table = (tables || []).find((entry) => entry.id === params.tableId);

  if (!table) {
    throw new Error('Selected table could not be found locally');
  }

  // Don't allow opening session if table is already in a paid/session
  if (table.status === 'free') {
    // Proceed
  } else {
    // Check if existing session is paid
    const existingSession =
      (sessions || [])
        .filter((entry) => entry.table_id === params.tableId && ACTIVE_SESSION_STATUSES.includes(entry.status))
        .sort((left, right) => new Date(right.opened_at).getTime() - new Date(left.opened_at).getTime())[0] ?? null;
    if (existingSession && existingSession.payment_status === 'paid') {
      throw new Error('This table is already paid');
    }
  }

  const targetGuestCount = Math.max(Number(params.guestCount || 1), 1);
  let session =
    (sessions || [])
      .filter((entry) => entry.table_id === params.tableId && ACTIVE_SESSION_STATUSES.includes(entry.status))
      .sort((left, right) => new Date(right.opened_at).getTime() - new Date(left.opened_at).getTime())[0] ?? null;

  // If session is already paid, don't modify it
  if (session && session.payment_status === 'paid') {
    throw new Error('This session is already paid');
  }

  const existingSeats = (seats || []).filter((entry) => entry.session_id === session?.id);

  // If no active session exists, create one locally
  if (!session) {
    const fallbackSessionId = buildFallbackSessionId(table.id, table.table_number);
    const newSession: HotelTableSession = {
      id: fallbackSessionId,
      table_id: params.tableId,
      table_number: table.table_number,
      guest_count: targetGuestCount,
      status: 'active',
      payment_status: 'pending',
      opened_at: now,
      opened_by: params.openedBy || null,
      opened_shift_id: params.openedShiftId || null,
      closed_at: null,
      notes: params.notes || null,
      created_at: now,
      updated_at: now,
    };

    await saveLocalData('hotel_table_sessions', [...(sessions || []), newSession]);

    // Create seats
    const newSeats: HotelTableSessionSeat[] = Array.from({ length: targetGuestCount }, (_, i) => ({
      id: `${fallbackSessionId}:seat:${i + 1}`,
      session_id: newSession.id,
      seat_no: i + 1,
      guest_name: null,
      status: 'active',
      payment_status: 'pending',
      item_total: 0,
      paid_at: null,
      created_at: now,
      updated_at: now,
    }));

    await saveLocalData('hotel_table_session_seats', [...(seats || []), ...newSeats]);

    session = newSession;
  } else {
    const nextSession: HotelTableSession = {
      ...session,
      table_number: table.table_number,
      guest_count: Math.max(targetGuestCount, Number(session.guest_count || 0), 1),
      opened_by: session.opened_by || params.openedBy || null,
      opened_shift_id: session.opened_shift_id || params.openedShiftId || null,
      notes: params.notes ?? session.notes ?? null,
      status: ACTIVE_SESSION_STATUSES.includes(session.status) ? session.status : 'active',
      payment_status: session.payment_status || 'pending',
      updated_at: now,
    };

    session = nextSession;
    await saveLocalData(
      'hotel_table_sessions',
      (sessions || []).map((entry) => (entry.id === nextSession.id ? nextSession : entry))
    );

    const seatUpdates: HotelTableSessionSeat[] = [];
    for (let seatNo = 1; seatNo <= nextSession.guest_count; seatNo += 1) {
      const existingSeat = existingSeats.find((entry) => entry.seat_no === seatNo);
      if (existingSeat) {
        seatUpdates.push({
          ...existingSeat,
          status: existingSeat.status || 'active',
          payment_status: existingSeat.payment_status || 'pending',
          updated_at: now,
        });
        continue;
      }

      seatUpdates.push({
        id: crypto.randomUUID(),
        session_id: nextSession.id,
        seat_no: seatNo,
        guest_name: null,
        status: 'active',
        payment_status: 'pending',
        item_total: 0,
        paid_at: null,
        created_at: now,
        updated_at: now,
      });
    }

    if (seatUpdates.length > 0) {
      const untouchedSeats = (seats || []).filter((entry) => entry.session_id !== nextSession.id);
      await saveLocalData('hotel_table_session_seats', [...untouchedSeats, ...seatUpdates]);
    }
  }

  await saveLocalData(
    'hotel_tables',
    (tables || []).map((entry) =>
      entry.id === table.id
        ? { ...entry, status: 'occupied', cleaning_started_at: null, updated_at: now }
        : entry
    )
  );

  return session;
}

async function recordLocalTableSessionPayment(params: {
  queryClient: QueryClient;
  sessionId: string;
  paymentMethod: string;
  staffId?: string | null;
  shiftId?: string | null;
  amount?: number | null;
  seatId?: string | null;
  paymentGroupId?: string | null;
  receiptNo?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
}) {
  const paymentId = crypto.randomUUID();

  let targetAmount = params.amount;
  const summary = await buildLocalTableSessionSummary(params.sessionId);
  if (!targetAmount) {
    if (params.paymentGroupId) {
      const group = summary?.groups.find(g => g.payment_group_id === params.paymentGroupId);
      targetAmount = group?.outstanding_amount || 0;
    } else if (params.seatId) {
      const seat = summary?.seats.find(s => s.seat_id === params.seatId);
      targetAmount = seat?.outstanding_amount || 0;
    } else {
      targetAmount = summary?.outstanding_amount || 0;
    }
  }

  await syncService.performOperation('hotel_payments', 'insert', {
    id: paymentId,
    session_id: params.sessionId,
    payment_group_id: params.paymentGroupId || null,
    seat_id: params.seatId || null,
    amount: targetAmount || 0,
    payment_method: params.paymentMethod,
    staff_id: params.staffId || null,
    shift_id: params.shiftId || null,
    status: 'posted',
    receipt_no: params.receiptNo || null,
    notes: params.notes || 'Offline local payment',
    idempotency_key: params.idempotencyKey || null,
    created_at: new Date().toISOString(),
  });

  if (isFallbackSessionId(params.sessionId)) {
    const { tableId, tableNumber } = parseFallbackSessionId(params.sessionId);
    const updatedSummary = await buildLocalTableSessionSummary(params.sessionId);
    const isFullyPaid = updatedSummary?.payment_status === 'paid';

    if (isFullyPaid && updatedSummary) {
      const orders = await getLocalData<HotelOrder>('hotel_orders');
      const updatedOrders = (orders || []).map(o => {
        const isLinked =
          (tableId && o.table_id === tableId) ||
          (tableNumber && normalizeTableNumber(o.table_number) === normalizeTableNumber(tableNumber));

        if (isLinked && FALLBACK_ACTIVE_ORDER_STATUSES.includes(String(o.status || ''))) {
          return {
            ...o,
            status: 'settled' as any,
            updated_at: new Date().toISOString()
          };
        }
        return o;
      });
      await saveLocalData('hotel_orders', updatedOrders);
      await setHotelTableStatus(tableId, tableNumber, 'free', params.queryClient);
    }

    return {
      session_id: params.sessionId,
      payment_ids: [paymentId],
      session_fully_paid: updatedSummary?.payment_status === 'paid',
      table_id: tableId,
      table_number: tableNumber
    };
  }

  await refreshLocalTableSessionState(params.sessionId);
  const updatedSummary = await buildLocalTableSessionSummary(params.sessionId);
  const sessions = await getLocalData<HotelTableSession>('hotel_table_sessions');
  const session = sessions?.find(s => s.id === params.sessionId);

  if (updatedSummary?.payment_status === 'paid' && session?.table_id) {
    await setHotelTableStatus(session.table_id, session.table_number, 'free', params.queryClient);
  }

  return {
    session_id: params.sessionId,
    payment_ids: [paymentId],
    session_fully_paid: updatedSummary?.payment_status === 'paid',
    table_id: session?.table_id,
    table_number: session?.table_number
  };
}

async function upsertLocalTableSessionSnapshot(
  session: HotelTableSession,
  params?: {
    guestCount?: number;
    openedBy?: string | null;
    openedShiftId?: string | null;
    notes?: string | null;
  }
) {
  const now = new Date().toISOString();
  const [sessions, seats, tables] = await Promise.all([
    getLocalData<HotelTableSession>('hotel_table_sessions'),
    getLocalData<HotelTableSessionSeat>('hotel_table_session_seats'),
    getLocalData<HotelTable>('hotel_tables'),
  ]);

  const existingSession = (sessions || []).find((entry) => entry.id === session.id) || null;
  const targetGuestCount = Math.max(
    Number(session.guest_count || 0),
    Number(params?.guestCount || 0),
    1
  );

  const nextSession: HotelTableSession = {
    ...(existingSession || session),
    ...session,
    guest_count: targetGuestCount,
    table_number: session.table_number || existingSession?.table_number || null,
    opened_by: session.opened_by || existingSession?.opened_by || params?.openedBy || null,
    opened_shift_id: session.opened_shift_id || existingSession?.opened_shift_id || params?.openedShiftId || null,
    notes: session.notes ?? existingSession?.notes ?? params?.notes ?? null,
    status: ACTIVE_SESSION_STATUSES.includes(session.status) ? session.status : 'active',
    payment_status: session.payment_status || existingSession?.payment_status || 'pending',
    updated_at: session.updated_at || now,
  };

  const nextSessions = existingSession
    ? (sessions || []).map((entry) => (entry.id === nextSession.id ? nextSession : entry))
    : [...(sessions || []), nextSession];

  const existingSeats = (seats || []).filter((entry) => entry.session_id === nextSession.id);
  const nextSessionSeats: HotelTableSessionSeat[] = Array.from({ length: targetGuestCount }, (_, index) => {
    const seatNo = index + 1;
    const existingSeat = existingSeats.find((entry) => entry.seat_no === seatNo);

    return {
      id: existingSeat?.id || crypto.randomUUID(),
      session_id: nextSession.id,
      seat_no: seatNo,
      guest_name: existingSeat?.guest_name || null,
      status: existingSeat?.status || 'active',
      payment_status: existingSeat?.payment_status || 'pending',
      item_total: (existingSeat as any)?.item_total || 0,
      paid_at: existingSeat?.paid_at || null,
      created_at: existingSeat?.created_at || now,
      updated_at: now,
    };
  });

  const untouchedSeats = (seats || []).filter((entry) => entry.session_id !== nextSession.id);

  const nextTables = (tables || []).map((entry) =>
    entry.id === nextSession.table_id
      ? { ...entry, status: 'occupied', updated_at: now }
      : entry
  );

  await Promise.all([
    saveLocalData('hotel_table_sessions', nextSessions),
    saveLocalData('hotel_table_session_seats', [...untouchedSeats, ...nextSessionSeats]),
    saveLocalData('hotel_tables', nextTables),
  ]);

  return nextSession;
}

async function loadLocalActiveSession(tableId?: string | null) {
  if (!tableId) return null;

  const [sessions, seats] = await Promise.all([
    getLocalData<HotelTableSession>('hotel_table_sessions'),
    getLocalData<HotelTableSessionSeat>('hotel_table_session_seats'),
  ]);

  const session = (sessions || [])
    .filter((item) => item.table_id === tableId && ['active', 'partially_paid'].includes(item.status))
    .sort((left, right) => new Date(right.opened_at).getTime() - new Date(left.opened_at).getTime())[0];

  if (!session) {
    return null;
  }

  return {
    ...session,
    seats: (seats || [])
      .filter((seat) => seat.session_id === session.id)
      .sort((left, right) => left.seat_no - right.seat_no),
  } satisfies ActiveSessionRecord;
}

async function loadLocalSessionBillingItems(sessionId?: string | null) {
  if (!sessionId) return [];

  // FIX: Fallback sessions don't exist in IndexedDB — resolve from orders directly
  if (isFallbackSessionId(sessionId)) {
    return loadFallbackSessionBillingItems(sessionId);
  }

  const [sessions, sessionSeats, orders, items] = await Promise.all([
    getLocalData<HotelTableSession>('hotel_table_sessions'),
    getLocalData<HotelTableSessionSeat>('hotel_table_session_seats'),
    getLocalData<HotelOrder>('hotel_orders'),
    getLocalData<HotelOrderItem>('hotel_order_items'),
  ]);

  const session = (sessions || []).find((entry) => entry.id === sessionId) || null;
  if (!session) {
    return loadOrphanSessionBillingItems(sessionId);
  }
  const seatsForSession = (sessionSeats || [])
    .filter((entry) => entry.session_id === sessionId)
    .sort((left, right) => left.seat_no - right.seat_no);
  const sessionOrders = resolveLocalSessionOrders(sessionId, session, orders || []);
  if (sessionOrders.length === 0) {
    return [];
  }

  const orderMap = new Map(sessionOrders.map((order) => [order.id, order]));

  return (items || [])
    .filter((item) => orderMap.has(item.order_id))
    .map((item) => {
      const order = orderMap.get(item.order_id)!;
      const resolvedSeatId = resolveSessionSeatId(
        seatsForSession,
        item.seat_id || order.seat_id || null,
        item.seat_no || null
      );
      const resolvedSeatNo = resolveSessionSeatNo(
        seatsForSession,
        item.seat_id || order.seat_id || null,
        item.seat_no || null
      );

      return {
        item_id: item.id,
        order_id: item.order_id,
        order_number: order.order_number,
        customer_id: order.customer_id || null,
        customer_name: order.customer_name || null,
        customer_phone: order.customer_phone || null,
        customer_email: order.customer_email || null,
        customer_address: order.customer_address || null,
        customer_tin: order.customer_tin || null,
        seat_id: resolvedSeatId,
        seat_no: resolvedSeatNo,
        payment_group_id: item.payment_group_id || null,
        name: item.name,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0),
        status: item.status,
        notes: item.notes || null,
        created_at: item.created_at,
      } satisfies HotelTableSessionBillingItem;
    })
    .sort((left, right) => {
      const seatDiff = Number(left.seat_no || 0) - Number(right.seat_no || 0);
      if (seatDiff !== 0) return seatDiff;
      return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    });
}

async function loadLocalActiveSessions() {
  const [sessions, seats, tables, staff, orders] = await Promise.all([
    getLocalData<HotelTableSession>('hotel_table_sessions'),
    getLocalData<HotelTableSessionSeat>('hotel_table_session_seats'),
    getLocalData<HotelTable>('hotel_tables'),
    getLocalData<{ id: string; first_name: string; last_name: string; role: string }>('hotel_staff'),
    getLocalData<HotelOrder>('hotel_orders'),
  ]);

  const hydratedSessions = await Promise.all(
    (sessions || []).map(async (session) => {
      const summary = await buildLocalTableSessionSummary(session.id);
      const effectiveStatus = summary?.status || session.status;

      if (!ACTIVE_SESSION_STATUSES.includes(effectiveStatus)) {
        return null;
      }

      return {
        ...session,
        status: effectiveStatus,
        payment_status: summary?.payment_status || session.payment_status,
        total_amount: summary?.total_amount || 0,
        total_paid: summary?.total_paid || 0,
        outstanding_amount: summary?.outstanding_amount || 0,
        seats: (seats || [])
          .filter((seat) => seat.session_id === session.id)
          .sort((left, right) => left.seat_no - right.seat_no),
        groups: summary?.groups || [],
        table: session.table_id
          ? (tables || []).find((table) => table.id === session.table_id) || null
          : null,
        opener: session.opened_by
          ? (staff || []).find((member) => member.id === session.opened_by) || null
          : null,
      };
    })
  );

  const resolvedSessions = hydratedSessions
    .filter((session): session is NonNullable<typeof session> => !!session)
    .sort((left, right) => new Date(right.opened_at).getTime() - new Date(left.opened_at).getTime());
  const fallbackSessions = buildFallbackActiveSessionsFromOrders({
    orders: orders || [],
    tables: tables || [],
    staff: staff || [],
    existingSessions: resolvedSessions,
  });

  return [...resolvedSessions, ...fallbackSessions].sort(
    (left, right) => new Date(right.opened_at).getTime() - new Date(left.opened_at).getTime()
  );
}

function mergeTableSessionSummary(
  localSummary: HotelTableSessionSummary | null,
  remoteSummary: HotelTableSessionSummary | null
) {
  if (!localSummary) return remoteSummary;
  if (!remoteSummary) return localSummary;

  const localSeatValue = localSummary.seats.reduce((sum, seat) => sum + Number(seat.item_total || 0), 0);
  const remoteSeatValue = remoteSummary.seats.reduce((sum, seat) => sum + Number(seat.item_total || 0), 0);
  const preferLocalAmounts =
    Number(localSummary.total_amount || 0) > Number(remoteSummary.total_amount || 0) + 0.01 ||
    localSeatValue > remoteSeatValue + 0.01;

  const totalAmount = preferLocalAmounts
    ? Number(localSummary.total_amount || 0)
    : Math.max(Number(localSummary.total_amount || 0), Number(remoteSummary.total_amount || 0));
  const depositCreditTotal = Math.max(
    Number(localSummary.deposit_credit_total || 0),
    Number(remoteSummary.deposit_credit_total || 0)
  );
  const totalPaid = Math.max(Number(localSummary.total_paid || 0), Number(remoteSummary.total_paid || 0));
  const outstandingAmount = roundMoney(Math.max(totalAmount - depositCreditTotal - totalPaid, 0));
  const seats =
    localSeatValue > remoteSeatValue || localSummary.seats.length >= remoteSummary.seats.length
      ? localSummary.seats
      : remoteSummary.seats;
  const groups =
    (localSummary.groups || []).length >= (remoteSummary.groups || []).length
      ? localSummary.groups
      : remoteSummary.groups;

  return {
    ...remoteSummary,
    session_id: remoteSummary.session_id || localSummary.session_id,
    table_id: remoteSummary.table_id || localSummary.table_id,
    table_number: remoteSummary.table_number || localSummary.table_number,
    guest_count: Math.max(Number(remoteSummary.guest_count || 0), Number(localSummary.guest_count || 0)),
    opened_at: remoteSummary.opened_at || localSummary.opened_at,
    opened_by: remoteSummary.opened_by || localSummary.opened_by,
    opened_shift_id: remoteSummary.opened_shift_id || localSummary.opened_shift_id,
    deposit_credit_total: roundMoney(depositCreditTotal),
    total_amount: roundMoney(totalAmount),
    total_paid: roundMoney(totalPaid),
    outstanding_amount: outstandingAmount,
    payment_status: outstandingAmount <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'pending',
    status: outstandingAmount <= 0 ? 'closed' : totalPaid > 0 ? 'partially_paid' : 'active',
    seats,
    groups,
  } satisfies HotelTableSessionSummary;
}

function mergeTableSessionBillingItems(
  localItems: HotelTableSessionBillingItem[],
  remoteItems: HotelTableSessionBillingItem[]
) {
  const merged = new Map<string, HotelTableSessionBillingItem>();

  for (const item of remoteItems) {
    merged.set(item.item_id, item);
  }

  for (const item of localItems) {
    merged.set(item.item_id, item);
  }

  return Array.from(merged.values()).sort((left, right) => {
    const seatDiff = Number(left.seat_no || 0) - Number(right.seat_no || 0);
    if (seatDiff !== 0) return seatDiff;
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}

/**
 * Resolves a raw session ID (which may be a fallback-session:… synthetic key)
 * to a real server UUID.
 *
 * - If rawSessionId is already a valid UUID → returns it immediately (no network call).
 * - If it's a fallback-session:… key → parses out tableId/tableNumber, queries
 *   Supabase for the active session on that table, and returns the real UUID.
 *   Falls back to checking local IndexedDB if offline.
 * - Returns null while resolving (isLoading = true) or if no real session exists yet.
 */
export function useResolvedSessionId(rawSessionId: string | null) {
  return useQuery({
    queryKey: ['hotel-resolved-session-id', rawSessionId],
    enabled: !!rawSessionId,
    staleTime: 30_000,
    retry: 2,
    refetchInterval: (query) => (query.state.data ? false : 3000),
    queryFn: async (): Promise<string | null> => {
      if (!rawSessionId) return null;

      // Already a real UUID — nothing to resolve
      if (isValidUuid(rawSessionId)) return rawSessionId;

      // Not a fallback key either — nothing we can do
      if (!isFallbackSessionId(rawSessionId)) return null;

      const { tableId, tableNumber } = parseFallbackSessionId(rawSessionId);

      // ── 1. Try Supabase first ─────────────────────────────────────────────
      if (navigator.onLine && (tableId || tableNumber)) {
        try {
          let query = apiClient
            .from('hotel_table_sessions')
            .select('id')
            .in('status', ['active', 'partially_paid'])
            .order('opened_at', { ascending: false })
            .limit(1);

          if (tableId) {
            query = query.eq('table_id', tableId) as typeof query;
          } else if (tableNumber) {
            query = query.eq('table_number', tableNumber) as typeof query;
          }

          const { data, error } = await query.maybeSingle();

          if (!error && data?.id && isValidUuid(data.id)) {
            // Kick off a background sync so subsequent billing queries have data
            void syncSessionFromCloud(data.id);
            return data.id;
          }
        } catch {
          // Fall through to local lookup
        }
      }

      // ── 2. Check local IndexedDB ─────────────────────────────────────────
      const sessions = await getLocalData<HotelTableSession>('hotel_table_sessions');
      const localSession = (sessions || [])
        .filter((s) => {
          if (!ACTIVE_SESSION_STATUSES.includes(s.status)) return false;
          if (tableId) return s.table_id === tableId;
          return (
            normalizeTableNumber(s.table_number) === normalizeTableNumber(tableNumber)
          );
        })
        .sort(
          (a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()
        )[0] ?? null;

      if (localSession && isValidUuid(localSession.id)) {
        return localSession.id;
      }

      // Session hasn't reached the server yet — caller shows "Session Not Ready"
      return null;
    },
  });
}

export function useActiveTableSession(tableId?: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['hotel-table-session', tableId],
    enabled: enabled && !!tableId,
    staleTime: 5000,
    queryFn: async () => {
      const localSession = await loadLocalActiveSession(tableId);

      if (!navigator.onLine || !tableId) {
        return localSession;
      }

      try {
        const { data, error } = await apiClient
          .from('hotel_table_sessions')
          .select(`
            *,
            seats:hotel_table_session_seats(*),
            opener:hotel_staff!hotel_table_sessions_opened_by_fkey(id, first_name, last_name, role)
          `)
          .eq('table_id', tableId)
          .in('status', ['active', 'partially_paid'])
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          await Promise.all([
            syncService.syncFromCloud('hotel_table_sessions', true),
            syncService.syncFromCloud('hotel_table_session_seats', true),
          ]);

          return {
            ...(data as ActiveSessionRecord),
            seats: [...((data as ActiveSessionRecord).seats || [])].sort((left, right) => left.seat_no - right.seat_no),
          };
        }
      } catch {
        // Fall back to local cache.
      }

      return localSession;
    },
  });
}

export function useOpenHotelTableSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tableId,
      guestCount,
      openedBy,
      openedShiftId,
      notes,
    }: {
      tableId: string;
      guestCount: number;
      openedBy?: string | null;
      openedShiftId?: string | null;
      notes?: string | null;
    }) => {
      // #region debug-point A:open-table-session-entry
      emitWaiterPosDebugEvent({ sessionId: 'send-order-button', runId: 'pre-fix', hypothesisId: 'A', location: 'useHotelTableSessions.useOpenHotelTableSession.mutationFn', msg: '[DEBUG] open table session mutation started', data: { tableId, guestCount, openedBy: openedBy || null, openedShiftId: openedShiftId || null, notes: notes || null, online: navigator.onLine, canUseApiClientSync: canUseApiClientSync() }, ts: Date.now() });
      // #endregion
      if (!navigator.onLine || !canUseApiClientSync()) {
        return openLocalTableSession({ tableId, guestCount, openedBy, openedShiftId, notes });
      }

      let remoteSession: HotelTableSession | null = null;
      let hydratedSession: HotelTableSession | null = null;

      try {
        // First check if there's an active session already
        const { data: existingSession, error: existingSessionError } = await apiClient
          .from('hotel_table_sessions')
          .select('*')
          .eq('table_id', tableId)
          .in('status', ['active', 'partially_paid'])
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingSessionError) {
          throw existingSessionError;
        }

        if (existingSession) {
          // Update existing session
          const { data: updatedSession, error: updatedSessionError } = await apiClient
            .from('hotel_table_sessions')
            .update({
              guest_count: Math.max(guestCount, existingSession.guest_count),
              opened_by: existingSession.opened_by || openedBy,
              opened_shift_id: existingSession.opened_shift_id || openedShiftId,
              notes: notes ?? existingSession.notes,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingSession.id)
            .select()
            .single();

          if (updatedSessionError || !updatedSession) {
            throw updatedSessionError || new Error('Failed to update the active table session');
          }

          remoteSession = updatedSession as HotelTableSession;

          // FIX (Part B): the session's guest_count may have just gone up,
          // but no new seat rows were ever created for the extra guest(s).
          // Check which seat_no values already exist, and insert any missing ones.
          const { data: existingSeatsRemote, error: existingSeatsError } = await apiClient
            .from('hotel_table_session_seats')
            .select('id, seat_no')
            .eq('session_id', existingSession.id);

          if (existingSeatsError) {
            throw existingSeatsError;
          }

          const currentSeatNos = new Set((existingSeatsRemote || []).map((seat) => seat.seat_no));
          const targetGuestCount = Math.max(guestCount, existingSession.guest_count);
          const missingSeats = [];

          for (let seatNo = 1; seatNo <= targetGuestCount; seatNo += 1) {
            if (!currentSeatNos.has(seatNo)) {
              missingSeats.push({
                id: crypto.randomUUID(),
                session_id: existingSession.id,
                seat_no: seatNo,
                guest_name: null,
                status: 'active',
                payment_status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            }
          }

          if (missingSeats.length > 0) {
            const { error: missingSeatInsertError } = await apiClient
              .from('hotel_table_session_seats')
              .insert(missingSeats);

            if (missingSeatInsertError) {
              throw missingSeatInsertError;
            }
          }
        } else {
          // Create new session
          const { data: newSession, error: newSessionError } = await apiClient
            .from('hotel_table_sessions')
            .insert({
              table_id: tableId,
              guest_count: guestCount,
              opened_by: openedBy,
              opened_shift_id: openedShiftId,
              notes: notes,
              status: 'active',
              payment_status: 'pending',
              opened_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (newSessionError || !newSession) {
            throw newSessionError || new Error('Failed to create a new table session');
          }

          remoteSession = newSession as HotelTableSession;

          // Create seats for the session
          const seats = Array.from({ length: guestCount }, (_, i) => ({
            id: crypto.randomUUID(),
            session_id: remoteSession.id,
            seat_no: i + 1,
            guest_name: null,
            status: 'active',
            payment_status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }));

          const { error: seatInsertError } = await apiClient.from('hotel_table_session_seats').insert(seats);
          if (seatInsertError) {
            throw seatInsertError;
          }
        }

        // Update table status to occupied
        // #region debug-point A:open-table-session-table-update
        emitWaiterPosDebugEvent({ sessionId: 'send-order-button', runId: 'pre-fix', hypothesisId: 'A', location: 'useHotelTableSessions.useOpenHotelTableSession.mutationFn', msg: '[DEBUG] open table session updating hotel table to occupied', data: { tableId, sessionId: remoteSession.id, sessionStatus: remoteSession.status, paymentStatus: remoteSession.payment_status }, ts: Date.now() });
        // #endregion
        await setHotelTableStatus(tableId, remoteSession.table_number, 'occupied', queryClient);

        hydratedSession = await upsertLocalTableSessionSnapshot(remoteSession, {
          guestCount,
          openedBy,
          openedShiftId,
          notes,
        });

        await Promise.all([
          syncService.syncFromCloud('hotel_table_sessions', true),
          syncService.syncFromCloud('hotel_table_session_seats', true),
          syncService.syncFromCloud('hotel_tables', true),
        ]).catch((syncError) => {
          console.warn('Table session sync refresh failed after a successful remote open:', syncError);
        });

        return hydratedSession;
      } catch (error) {
        // #region debug-point A:open-table-session-fallback
        emitWaiterPosDebugEvent({ sessionId: 'send-order-button', runId: 'pre-fix', hypothesisId: 'A', location: 'useHotelTableSessions.useOpenHotelTableSession.mutationFn', msg: '[DEBUG] open table session fell back to local mode', data: { tableId, guestCount, error: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, ts: Date.now() });
        // #endregion
        if (isBackendTransientError(error)) {
          setBackendUnreachable();

          if (hydratedSession) {
            return hydratedSession;
          }

          if (remoteSession) {
            return upsertLocalTableSessionSnapshot(remoteSession, {
              guestCount,
              openedBy,
              openedShiftId,
              notes,
            });
          }

          return openLocalTableSession({ tableId, guestCount, openedBy, openedShiftId, notes });
        }

        throw error instanceof Error ? error : new Error('Failed to open table session');
      }
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session', session.table_id] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session-summary', session.id] });
      queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to open table session'),
  });
}

/**
 * Syncs a session and its related orders/items/seats from Supabase into IndexedDB.
 * Called when the local summary is missing or empty for a known real session UUID.
 */
async function syncSessionFromCloud(sessionId: string): Promise<void> {
  try {
    // Sync session + seats
    const { data: sessionData, error: sessionError } = await apiClient
      .from('hotel_table_sessions')
      .select('*, seats:hotel_table_session_seats(*)')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError || !sessionData) return;

    const session = sessionData as HotelTableSession & { seats?: HotelTableSessionSeat[] };
    const seats: HotelTableSessionSeat[] = session.seats || [];

    // Persist session
    const existingSessions = await getLocalData<HotelTableSession>('hotel_table_sessions');
    const sessionMap = new Map((existingSessions || []).map((s) => [s.id, s]));
    sessionMap.set(session.id, { ...session, seats: undefined } as HotelTableSession);
    await saveLocalData('hotel_table_sessions', Array.from(sessionMap.values()));

    // Persist seats
    if (seats.length > 0) {
      const existingSeats = await getLocalData<HotelTableSessionSeat>('hotel_table_session_seats');
      const seatMap = new Map((existingSeats || []).map((s) => [s.id, s]));
      seats.forEach((seat) => seatMap.set(seat.id, seat));
      await saveLocalData('hotel_table_session_seats', Array.from(seatMap.values()));
    }

   // Only sync orders that are explicitly linked to this session via session_id.
    // We intentionally do NOT fall back to table_id + active-status matching here:
    // that fallback used to "rescue" orders created before a session finished syncing,
    // but it also silently re-attaches deliberately standalone orders (session_id: null,
    // e.g. a second, separate customer on the same table) back into this session —
    // which is exactly the bug we fixed in SplitBillDialog/handleCreateNewOrder.
    const { data: ordersData, error: ordersError } = await apiClient
      .from('hotel_orders')
      .select('*, items:hotel_order_items(*)')
      .eq('session_id', sessionId);

    const allOrders = (!ordersError && ordersData
      ? ordersData
      : []) as Array<HotelOrder & { items?: HotelOrderItem[] }>;

    const allItems: HotelOrderItem[] = allOrders.flatMap((o) => o.items || []);

    if (allOrders.length > 0) {
      const existingOrders = await getLocalData<HotelOrder>('hotel_orders');
      const orderMap = new Map((existingOrders || []).map((o) => [o.id, o]));
      allOrders.forEach((order) =>
        orderMap.set(order.id, {
          ...order,
          // Ensure session_id is set locally too
          session_id: order.session_id || sessionId,
          items: undefined,
        } as HotelOrder)
      );
      await saveLocalData('hotel_orders', Array.from(orderMap.values()));
    }

    if (allItems.length > 0) {
      const existingItems = await getLocalData<HotelOrderItem>('hotel_order_items');
      const itemMap = new Map((existingItems || []).map((i) => [i.id, i]));
      allItems.forEach((item) => itemMap.set(item.id, item));
      await saveLocalData('hotel_order_items', Array.from(itemMap.values()));
    }

    // Sync payments for this session
    const { data: paymentsData } = await apiClient
      .from('hotel_payments')
      .select('*')
      .eq('session_id', sessionId);

    if (paymentsData && paymentsData.length > 0) {
      const existingPayments = await getLocalData<any>('hotel_payments');
      const paymentMap = new Map((existingPayments || []).map((p: any) => [p.id, p]));
      paymentsData.forEach((p) => paymentMap.set(p.id, p));
      await saveLocalData('hotel_payments', Array.from(paymentMap.values()));
    }
  } catch {
    // Silently ignore — caller will fall back to whatever local data exists
  }
}

export function useTableSessionSummary(
  sessionId?: string | null,
  enabled: boolean = true,
  options?: { refetchIntervalMs?: number | false; refetchOnMount?: boolean | 'always' }
) {
  const refetchIntervalMs = options?.refetchIntervalMs ?? false;
  const refetchOnMount = options?.refetchOnMount ?? false;

  return useQuery({
    queryKey: ['hotel-table-session-summary', sessionId],
    enabled: enabled && !!sessionId,
    staleTime: 10000,
    gcTime: 1000 * 60 * 10,
    refetchOnMount,
    refetchInterval: () => {
      if (!enabled || refetchIntervalMs === false) {
        return false;
      }
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return false;
      }
      return refetchIntervalMs;
    },
    queryFn: async () => {
      // Fallback sessions are synthetic — resolve from orders directly, no Supabase call
      if (isFallbackSessionId(sessionId)) {
        return buildFallbackSessionSummary(sessionId!);
      }

      let localSummary = await buildLocalTableSessionSummary(sessionId);

      if (!navigator.onLine) {
        return localSummary;
      }

      // FIX: If local summary is missing or has zero total, the session/orders
      // haven't synced to IndexedDB yet. Force-sync from cloud first, then rebuild.
      const localTotalAmount = Number(localSummary?.total_amount || 0);
      if (!localSummary || localTotalAmount === 0) {
        await syncSessionFromCloud(sessionId!);
        localSummary = await buildLocalTableSessionSummary(sessionId);
      }

      try {
        const { data, error } = await apiClient.rpc('get_hotel_table_session_summary', {
          p_session_id: sessionId,
        });
        if (error) throw error;
        return mergeTableSessionSummary(localSummary, (data as HotelTableSessionSummary) || null);
      } catch {
        return localSummary;
      }
    },
  });
}

export function useTableSessionBillingItems(
  sessionId?: string | null,
  enabled: boolean = true,
  options?: { refetchIntervalMs?: number | false; refetchOnMount?: boolean | 'always' }
) {
  const refetchIntervalMs = options?.refetchIntervalMs ?? false;
  const refetchOnMount = options?.refetchOnMount ?? false;

  return useQuery({
    queryKey: ['hotel-table-session-items', sessionId],
    enabled: enabled && !!sessionId,
    staleTime: 10000,
    gcTime: 1000 * 60 * 10,
    refetchOnMount,
    refetchInterval: () => {
      if (!enabled || refetchIntervalMs === false) {
        return false;
      }

      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return false;
      }

      return refetchIntervalMs;
    },
    queryFn: async () => {
      // Fallback sessions are synthetic — resolve from orders directly
      if (isFallbackSessionId(sessionId)) {
        return loadFallbackSessionBillingItems(sessionId!);
      }

      let localSummary = await buildLocalTableSessionSummary(sessionId);
      let localItems = await loadLocalSessionBillingItems(sessionId);

      if (!navigator.onLine || !sessionId) {
        return localItems;
      }

      // FIX: If items are empty and session has no local data, sync from cloud first
      if (localItems.length === 0 && (!localSummary || Number(localSummary.total_amount || 0) === 0)) {
        await syncSessionFromCloud(sessionId);
        localSummary = await buildLocalTableSessionSummary(sessionId);
        localItems = await loadLocalSessionBillingItems(sessionId);
      }

      try {
        const { data, error } = await apiClient
          .from('hotel_orders')
          .select(`
            id,
            order_number,
            customer_id,
            customer_name,
            customer_phone,
            customer_email,
            customer_address,
            customer_tin,
            seat_id,
            items:hotel_order_items(
              id,
              seat_id,
              seat_no,
              payment_group_id,
              name,
              quantity,
              unit_price,
              total_price,
              status,
              notes,
              created_at
            )
          `)
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true });

        if (error) throw error;

        const remoteItems = ((data || []) as Array<{
          id: string;
          order_number: string;
          seat_id?: string | null;
          items?: Array<{
            id: string;
            seat_id?: string | null;
            seat_no?: number | null;
            payment_group_id?: string | null;
            name: string;
            quantity: number;
            unit_price: number;
            total_price: number;
            status: string;
            notes?: string | null;
            created_at: string;
          }>;
        }>)
          .flatMap((order) =>
            (order.items || []).map((item) => {
              const resolvedSeatId = resolveSessionSeatId(
                localSummary?.seats || [],
                item.seat_id || order.seat_id || null,
                item.seat_no ?? null
              );
              const resolvedSeatNo = resolveSessionSeatNo(
                localSummary?.seats || [],
                item.seat_id || order.seat_id || null,
                item.seat_no ?? null
              );

              return {
                item_id: item.id,
                order_id: order.id,
                order_number: order.order_number,
                customer_id: (order as any).customer_id || null,
                customer_name: (order as any).customer_name || null,
                customer_phone: (order as any).customer_phone || null,
                customer_email: order.customer_email || null,
                customer_address: order.customer_address || null,
                customer_tin: order.customer_tin || null,
                seat_id: resolvedSeatId,
                seat_no: resolvedSeatNo,
                payment_group_id: item.payment_group_id || null,
                name: item.name,
                quantity: Number(item.quantity || 0),
                unit_price: Number(item.unit_price || 0),
                total_price: Number(item.total_price || 0),
                status: item.status,
                notes: item.notes || null,
                created_at: item.created_at,
              } satisfies HotelTableSessionBillingItem;
            })
          )
          .sort((left, right) => {
            const seatDiff = Number(left.seat_no || 0) - Number(right.seat_no || 0);
            if (seatDiff !== 0) return seatDiff;
            return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
          });

        return mergeTableSessionBillingItems(localItems, remoteItems);
      } catch {
        return localItems;
      }
    },
  });
}

export function useAssignCustomerToTableSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      customer,
    }: {
      sessionId: string;
      customer: {
        id?: string | null;
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        address?: string | null;
        tin_number?: string | null;
      } | null;
    }) => {
      const orders = await getLocalData<HotelOrder>('hotel_orders');
      const sessionOrders = (orders || []).filter(
        (order) => order.session_id === sessionId && order.status !== 'cancelled'
      );

      await Promise.all(
        sessionOrders.map((order) =>
          syncService.performOperation('hotel_orders', 'update', {
            id: order.id,
            customer_id: customer?.id || null,
            customer_name: customer?.name || null,
            customer_phone: customer?.phone || null,
            customer_email: customer?.email || null,
            customer_address: customer?.address || null,
            customer_tin: customer?.tin_number || null,
            updated_at: new Date().toISOString(),
          })
        )
      );

      return { updatedOrderIds: sessionOrders.map((order) => order.id) };
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session-summary', variables.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session-items', variables.sessionId] });
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to attach customer to this table session'),
  });
}

export function useRecordHotelTablePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      paymentMethod,
      staffId,
      shiftId,
      amount,
      seatId,
      paymentGroupId,
      receiptNo,
      notes,
      idempotencyKey,
    }: {
      sessionId: string;
      paymentMethod: string;
      staffId?: string | null;
      shiftId?: string | null;
      amount?: number | null;
      seatId?: string | null;
      paymentGroupId?: string | null;
      receiptNo?: string | null;
      notes?: string | null;
      idempotencyKey?: string | null;
    }) => {
      const localPaymentParams = {
        queryClient,
        sessionId,
        paymentMethod,
        staffId,
        shiftId,
        amount,
        seatId,
        paymentGroupId,
        receiptNo,
        notes,
        idempotencyKey,
      };

      // Offline fallback
      if (!navigator.onLine || !canUseApiClientSync() || isFallbackSessionId(sessionId)) {
        return recordLocalTableSessionPayment(localPaymentParams);
      }

      try {
        const { data, error } = await apiClient.rpc('record_hotel_table_payment' as any, {
          p_session_id: sessionId,
          p_payment_method: paymentMethod,
          p_staff_id: staffId || null,
          p_shift_id: shiftId || null,
          p_amount: amount ?? null,
          p_seat_id: seatId || null,
          p_payment_group_id: paymentGroupId || null,
          p_receipt_no: receiptNo || null,
          p_notes: notes || null,
          p_idempotency_key: idempotencyKey || null,
        });

        if (error) {
          if (isBackendTransientError(error)) {
            setBackendUnreachable();
            return recordLocalTableSessionPayment({
              ...localPaymentParams,
              notes: notes || 'Transient RPC failure - local fallback payment',
            });
          }

          throw error;
        }

        await Promise.all([
          syncService.syncFromCloud('hotel_payments', true),
          syncService.syncFromCloud('hotel_invoices', true),
          syncService.syncFromCloud('hotel_invoice_items', true),
          syncService.syncFromCloud('hotel_orders', true),
          syncService.syncFromCloud('hotel_table_sessions', true),
          syncService.syncFromCloud('hotel_table_session_seats', true),
          syncService.syncFromCloud('hotel_table_payment_groups', true),
          syncService.syncFromCloud('hotel_tables', true),
        ]).catch((syncError) => {
          console.warn('Table payment sync refresh failed after a successful remote payment:', syncError);
        });

        return data as {
          session_id: string;
          payment_ids: string[];
          session_status?: string;
          session_payment_status?: string;
          table_status?: string;
          session_fully_paid?: boolean;
          table_id?: string;
          table_number?: string;
        };
    } catch (error) {
        if (isBackendTransientError(error)) {
          setBackendUnreachable();
          return recordLocalTableSessionPayment({
            ...localPaymentParams,
            notes: notes || 'Transient RPC failure - local fallback payment',
          });
        }

        if (error instanceof Error) throw error;

        // Preserve the real Postgres/RPC error instead of a generic message,
        // so failures like "seat already paid" or a check-constraint violation
        // are visible instead of being masked as "Failed to record table payment".
        const pgError = error as { message?: string; details?: string; hint?: string; code?: string } | null;
        const detail = pgError?.message || pgError?.details || pgError?.hint || 'Unknown RPC error';
        throw new Error(`Failed to record table payment: ${detail}${pgError?.code ? ` (code ${pgError.code})` : ''}`);
      }
    },
    onSuccess: async (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session-summary', variables.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      toast.success('Table payment recorded');
      
      // If session is fully paid, release the table immediately
      if (result?.session_fully_paid) {
        const tableId = result?.table_id;
        const tableNumber = result?.table_number;
        
        // If we don't have table info from result, get it from local data
        if (!tableId) {
          const sessions = await getLocalData<HotelTableSession>('hotel_table_sessions');
          const session = sessions?.find(s => s.id === variables.sessionId);
          if (session) {
            await releaseHotelTableIfNoActiveOrders(session.table_id, session.table_number, undefined, 'free', queryClient);
          }
        } else {
          await releaseHotelTableIfNoActiveOrders(tableId, tableNumber, undefined, 'free', queryClient);
        }
      }
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to record table payment'),
  });
}

export function useUpsertHotelTablePaymentGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      groupName,
      seatIds,
      createdBy,
    }: {
      sessionId: string;
      groupName: string;
      seatIds: string[];
      createdBy?: string | null;
    }) => {
      const { data, error } = await apiClient.rpc('upsert_hotel_table_payment_group', {
        p_session_id: sessionId,
        p_group_name: groupName,
        p_seat_ids: seatIds,
        p_created_by: createdBy || null,
      });

      if (error) throw error;

      await Promise.all([
        syncService.syncFromCloud('hotel_table_payment_groups', true),
        syncService.syncFromCloud('hotel_table_payment_group_seats', true),
        syncService.syncFromCloud('hotel_table_session_seats', true),
      ]);

      return data;
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session-summary', variables.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session'] });
      toast.success('Payment group saved');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to save payment group'),
  });
}

export function useActiveTableSessions(enabled: boolean = true) {
  return useQuery({
    queryKey: ['hotel-active-table-sessions'],
    enabled,
    staleTime: 5000,
    queryFn: async () => {
      const localSessions = await loadLocalActiveSessions();

      if (!navigator.onLine) {
        return localSessions;
      }

      let remoteSessionRows:
        | Array<
            ActiveSessionRecord & {
              table?: { id: string; table_number: string; name: string | null; status: string } | null;
            }
          >
        | null = null;
      let remoteOrders:
        | Array<
            Partial<HotelOrder> & {
              waiter?: { id: string; first_name: string; last_name: string; role: string } | null;
              table?: { id: string; table_number: string; name: string | null; status: string } | null;
            }
          >
        | null = null;

      try {
        const [remoteSessionsResult, remoteOrdersResult] = await Promise.all([
          safeApiClientCall<Array<
            ActiveSessionRecord & {
              table?: { id: string; table_number: string; name: string | null; status: string } | null;
            }
          >>(
            apiClient
              .from('hotel_table_sessions')
              .select(`
                *,
                seats:hotel_table_session_seats(*),
                table:hotel_tables(id, table_number, name, status),
                opener:hotel_staff!hotel_table_sessions_opened_by_fkey(id, first_name, last_name, role)
              `)
              .in('status', ['active', 'partially_paid'])
              .order('opened_at', { ascending: false }) as any
          ),
          safeApiClientCall<Array<Partial<HotelOrder> & {
            waiter?: { id: string; first_name: string; last_name: string; role: string } | null;
            table?: { id: string; table_number: string; name: string | null; status: string } | null;
          }>>(
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
                shift_id,
                status,
                total_amount,
                created_at,
                updated_at,
                waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name, role),
                table:hotel_tables(id, table_number, name, status)
              `)
              .in('status', FALLBACK_ACTIVE_ORDER_STATUSES as any)
              .order('updated_at', { ascending: false }) as any
          ),
        ]);

        remoteSessionRows = remoteSessionsResult || null;
        remoteOrders = remoteOrdersResult || null;
      } catch {
        return localSessions;
      }

      if (remoteSessionRows) {
        const localRawSessions = await getLocalData<HotelTableSession>('hotel_table_sessions');
        const localRawSeats = await getLocalData<HotelTableSessionSeat>('hotel_table_session_seats');
        const mergedSessionsById = new Map((localRawSessions || []).map((session) => [session.id, session]));
        const mergedSeatsById = new Map((localRawSeats || []).map((seat) => [seat.id, seat]));

        remoteSessionRows.forEach((session) => {
          mergedSessionsById.set(session.id, session as HotelTableSession);
          (session.seats || []).forEach((seat) => {
            mergedSeatsById.set(seat.id, seat);
          });
        });

        await Promise.all([
          saveLocalData('hotel_table_sessions', Array.from(mergedSessionsById.values())),
          saveLocalData('hotel_table_session_seats', Array.from(mergedSeatsById.values())),
        ]);
      }

      const remoteSessions = (remoteSessionRows || []) as Array<
        ActiveSessionRecord & {
          table?: { id: string; table_number: string; name: string | null; status: string } | null;
        }
      >;
      const hydratedRemoteSessions = await Promise.all(
        remoteSessions.map(async (session) => {
          const localSummary = await buildLocalTableSessionSummary(session.id);
          return {
            ...session,
            status: localSummary?.status || session.status,
            payment_status: localSummary?.payment_status || session.payment_status,
            total_amount: localSummary?.total_amount || 0,
            total_paid: localSummary?.total_paid || 0,
            outstanding_amount: localSummary?.outstanding_amount || 0,
            groups: localSummary?.groups || [],
          } satisfies ActiveSessionWithSummary & {
            table?: { id: string; table_number: string; name: string | null; status: string } | null;
          };
        })
      );

      const mergedById = new Map(
        localSessions.map((session) => [session.id, session as ActiveSessionWithSummary & { table?: any }])
      );

      hydratedRemoteSessions.forEach((session) => {
        const existing = mergedById.get(session.id);
        if (!existing) {
          mergedById.set(session.id, session);
          return;
        }

        const totalAmount = Math.max(Number(existing.total_amount || 0), Number(session.total_amount || 0));
        const totalPaid = Math.max(Number(existing.total_paid || 0), Number(session.total_paid || 0));
        const outstandingAmount = roundMoney(Math.max(totalAmount - totalPaid, 0));
        const paymentStatus = outstandingAmount <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'pending';
        const status = outstandingAmount <= 0 ? 'closed' : totalPaid > 0 ? 'partially_paid' : 'active';

        mergedById.set(session.id, {
          ...existing,
          ...session,
          status,
          payment_status: paymentStatus,
          total_amount: totalAmount,
          total_paid: totalPaid,
          outstanding_amount: outstandingAmount,
          seats: (session.seats || []).length > 0 ? session.seats : existing.seats,
          groups: (session.groups || []).length > 0 ? session.groups : existing.groups,
          table: session.table || existing.table,
          opener: session.opener || existing.opener,
        });
      });

      const localTables = await getLocalData<HotelTable>('hotel_tables');
      const localStaff = await getLocalData<{ id: string; first_name: string; last_name: string; role: string }>('hotel_staff');
      const fallbackSessions = buildFallbackActiveSessionsFromOrders({
        orders: remoteOrders || [],
        tables: localTables || [],
        staff: localStaff || [],
        existingSessions: Array.from(mergedById.values()),
      });

      fallbackSessions.forEach((session) => {
        if (!mergedById.has(session.id)) {
          mergedById.set(session.id, session);
        }
      });

      return Array.from(mergedById.values()).sort(
        (left, right) => new Date(right.opened_at).getTime() - new Date(left.opened_at).getTime()
      );
    },
  });
}
