type SeatLike = {
  id?: string;
  seat_id?: string;
  seat_no: number;
};

type OrderLike = {
  id: string;
  order_type?: string | null;
  subtotal?: number | null;
  total_amount?: number | null;
  deposit_amount?: number | null;
  checked_in_at?: string | null;
  seat_id?: string | null;
  seat_no?: number | null;
  status?: string | null;
};

type ItemLike = {
  order_id: string;
  total_price?: number | null;
  seat_id?: string | null;
  seat_no?: number | null;
  status?: string | null;
};

export interface SeatChargeAllocation {
  subtotal: number;
  total: number;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function getSeatId(seat: SeatLike) {
  return seat.seat_id || seat.id || '';
}

export function buildSessionSeatChargeMap(params: {
  orders: OrderLike[];
  items: ItemLike[];
  sessionSeats: SeatLike[];
  fallbackSeatId?: string | null;
}) {
  const seatIdBySeatNo = new Map<number, string>();
  const seatNoBySeatId = new Map<string, number>();

  params.sessionSeats.forEach((seat) => {
    const seatId = getSeatId(seat);
    if (!seatId) return;
    seatIdBySeatNo.set(Number(seat.seat_no), seatId);
    seatNoBySeatId.set(seatId, Number(seat.seat_no));
  });

  const defaultSeatId =
    params.fallbackSeatId ||
    params.sessionSeats
      .slice()
      .sort((left, right) => Number(left.seat_no) - Number(right.seat_no))
      .map((seat) => getSeatId(seat))
      .find(Boolean) ||
    null;

  const resolveSeatId = (
    rawSeatId?: string | null,
    rawSeatNo?: number | null,
    orderSeatId?: string | null,
    orderSeatNo?: number | null
  ) => {
    if (rawSeatId && seatNoBySeatId.has(rawSeatId)) return rawSeatId;
    const numericSeatNo = Number(rawSeatNo || 0);
    if (numericSeatNo > 0 && seatIdBySeatNo.has(numericSeatNo)) {
      return seatIdBySeatNo.get(numericSeatNo) || null;
    }
    if (orderSeatId && seatNoBySeatId.has(orderSeatId)) return orderSeatId;
    const numericOrderSeatNo = Number(orderSeatNo || 0);
    if (numericOrderSeatNo > 0 && seatIdBySeatNo.has(numericOrderSeatNo)) {
      return seatIdBySeatNo.get(numericOrderSeatNo) || null;
    }
    // No explicit seat info on the item OR its parent order — do NOT fall
    // back to defaultSeatId (the first seat). That silently dumped freshly
    // added, not-yet-assigned items onto seat #1's total, which reopens a
    // seat that was already fully paid (its outstanding balance goes
    // positive again) the moment someone adds more items to a bill that has
    // already had a split payment on it. Leave it unresolved — the
    // per-order fallback below still covers the "nothing split yet" case
    // where the whole order legitimately belongs on one seat.
    return null;
  };

  const itemsByOrderId = new Map<string, ItemLike[]>();
  params.items
    .filter((item) => item.status !== 'cancelled')
    .forEach((item) => {
      const bucket = itemsByOrderId.get(item.order_id) || [];
      bucket.push(item);
      itemsByOrderId.set(item.order_id, bucket);
    });

  const totalsBySeatId = new Map<string, SeatChargeAllocation>();

  params.orders
    .filter((order) => order.status !== 'cancelled')
    .forEach((order) => {
      const orderItems = itemsByOrderId.get(order.id) || [];
      const orderSeatSubtotals = new Map<string, number>();

      orderItems.forEach((item) => {
        const resolvedSeatId = resolveSeatId(
          item.seat_id,
          item.seat_no,
          order.seat_id,
          order.seat_no
        );
        if (!resolvedSeatId) return;

        orderSeatSubtotals.set(
          resolvedSeatId,
          roundMoney(
            Number(orderSeatSubtotals.get(resolvedSeatId) || 0) +
            Number(item.total_price || 0)
          )
        );
      });

      if (orderSeatSubtotals.size === 0 && defaultSeatId) {
        orderSeatSubtotals.set(
          defaultSeatId,
          roundMoney(Number(order.subtotal || order.total_amount || 0))
        );
      }

      const orderSeats = Array.from(orderSeatSubtotals.entries())
        .map(([seatId, subtotal]) => ({
          seatId,
          subtotal: roundMoney(subtotal),
          seatNo: Number(seatNoBySeatId.get(seatId) || 0),
        }))
        .sort((left, right) => left.seatNo - right.seatNo || left.seatId.localeCompare(right.seatId));

      const orderSubtotal =
        roundMoney(orderSeats.reduce((sum, seat) => sum + seat.subtotal, 0)) ||
        roundMoney(Number(order.subtotal || 0));
      const grossOrderTotal = roundMoney(
        Number(order.total_amount ?? orderSubtotal)
      );
      const reservationDepositCredit =
        order.checked_in_at && Number(order.deposit_amount || 0) > 0
          ? roundMoney(Math.min(Number(order.deposit_amount || 0), grossOrderTotal))
          : 0;
      const orderTotal = roundMoney(
        Math.max(grossOrderTotal - reservationDepositCredit, 0)
      );

      let allocatedSoFar = 0;

      orderSeats.forEach((seat, index) => {
        const isLastSeat = index === orderSeats.length - 1;
        const proportionalTotal = orderSubtotal > 0
          ? roundMoney((orderTotal * seat.subtotal) / orderSubtotal)
          : 0;
        const allocatedTotal = isLastSeat
          ? roundMoney(orderTotal - allocatedSoFar)
          : proportionalTotal;
        allocatedSoFar = roundMoney(allocatedSoFar + allocatedTotal);

        const existing = totalsBySeatId.get(seat.seatId) || { subtotal: 0, total: 0 };
        totalsBySeatId.set(seat.seatId, {
          subtotal: roundMoney(existing.subtotal + seat.subtotal),
          total: roundMoney(existing.total + allocatedTotal),
        });
      });
    });

  return totalsBySeatId;
}
