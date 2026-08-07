import type { HotelPaymentRecord } from '@/types/hotel';

export const HOTEL_PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'momo', label: 'Mobile Money' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
] as const;

export function formatHotelPaymentMethod(method?: string | null) {
  if (!method) return 'Not settled';

  switch (method) {
    case 'momo':
      return 'Mobile Money';
    case 'bank_transfer':
      return 'Bank Transfer';
    case 'split':
      return 'Split Payment';
    default:
      return String(method)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

export function buildInvoicePaymentsMap(payments: HotelPaymentRecord[]) {
  return payments.reduce<Record<string, HotelPaymentRecord[]>>((acc, payment) => {
    if (!payment.invoice_id) return acc;
    if (!acc[payment.invoice_id]) {
      acc[payment.invoice_id] = [];
    }
    acc[payment.invoice_id].push(payment);
    return acc;
  }, {});
}

export function summarizePaymentMethods(payments: HotelPaymentRecord[]) {
  const validPayments = payments.filter(
    (payment) => payment.status !== 'void' && payment.status !== 'cancelled'
  );

  const totals = validPayments.reduce<Record<string, number>>((acc, payment) => {
    const method = String(payment.payment_method || '').trim() || 'unknown';
    acc[method] = Number(((acc[method] || 0) + Number(payment.amount || 0)).toFixed(2));
    return acc;
  }, {});

  const entries = Object.entries(totals)
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);

  const totalPaid = Number(
    entries.reduce((sum, [, amount]) => sum + amount, 0).toFixed(2)
  );

  const primaryMethod =
    entries.length === 0
      ? null
      : entries.length === 1
        ? entries[0][0]
        : 'split';

  return {
    totalPaid,
    primaryMethod,
    entries: entries.map(([method, amount]) => ({
      method,
      label: formatHotelPaymentMethod(method),
      amount,
    })),
  };
}

export function getInvoicePaymentSummary(
  invoiceId: string | null | undefined,
  paymentsMap: Record<string, HotelPaymentRecord[]>
) {
  if (!invoiceId) {
    return { totalPaid: 0, primaryMethod: null, entries: [] as Array<{ method: string; label: string; amount: number }> };
  }

  return summarizePaymentMethods(paymentsMap[invoiceId] || []);
}

export function filterPaymentsByDateRange(
  payments: HotelPaymentRecord[],
  startDate: Date,
  endDate: Date
) {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  return payments.filter((payment) => {
    const createdAt = new Date(payment.created_at).getTime();
    return createdAt >= startMs && createdAt <= endMs;
  });
}

export function getMethodTotal(payments: HotelPaymentRecord[], methods: string[]) {
  const methodSet = new Set(methods);
  return Number(
    payments
      .filter((payment) => methodSet.has(String(payment.payment_method || '')))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
      .toFixed(2)
  );
}
