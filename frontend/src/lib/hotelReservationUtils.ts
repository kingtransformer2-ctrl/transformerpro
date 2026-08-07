type ReservationLike = {
  order_type?: string | null;
  total_amount?: number | null;
  amount_paid?: number | null;
  deposit_amount?: number | null;
  checked_in_at?: string | null;
};

interface DepositCreditOptions {
  requireCheckIn?: boolean;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export function getReservationDepositCredit(
  order: ReservationLike | null | undefined,
  options?: DepositCreditOptions
) {
  if (!order) return 0;

  const depositAmount = Number(order.deposit_amount || 0);
  if (depositAmount <= 0) return 0;

  if (options?.requireCheckIn && !order.checked_in_at) {
    return 0;
  }

  const totalAmount = Number(order.total_amount || 0);
  if (totalAmount > 0) {
    return roundMoney(Math.min(depositAmount, totalAmount));
  }

  return roundMoney(depositAmount);
}

export function getEffectiveOrderPaidAmount(order: ReservationLike | null | undefined) {
  if (!order) return 0;
  return roundMoney(
    Number(order.amount_paid || 0) + getReservationDepositCredit(order)
  );
}

export function getOrderBalanceDue(order: ReservationLike | null | undefined) {
  if (!order) return 0;
  return roundMoney(
    Math.max(Number(order.total_amount || 0) - getEffectiveOrderPaidAmount(order), 0)
  );
}
