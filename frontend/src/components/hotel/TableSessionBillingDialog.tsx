import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HotelReceiptPrint, type HotelReceiptPrintItem } from '@/components/hotel/HotelReceiptPrint';
import {
  Loader2,
  Receipt,
  User,
  Wallet,
  Banknote,
  CreditCard,
  Smartphone,
  Clock3,
  UtensilsCrossed,
  Activity,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { cn } from '@/lib/utils';
import { useHotelInfo } from '@/hooks/useHotel';
import {
  useAssignCustomerToTableSession,
  useRecordHotelTablePayment,
  useTableSessionBillingItems,
  useTableSessionSummary,
  useResolvedSessionId,
} from '@/hooks/useHotelTableSessions';
import { HotelCustomerSelectorDialog } from '@/components/hotel/HotelCustomerSelectorDialog';
import type { Customer } from '@/hooks/useCustomers';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value?: string | null): boolean {
  return !!value && UUID_REGEX.test(value);
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'momo', label: 'Momo', icon: Smartphone },
  { value: 'bank_transfer', label: 'Bank', icon: Receipt },
];

function SectionDivider({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-border/60" />
      <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70 shadow-sm">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-border/60" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60',
    partial: 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60',
    pending: 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/60',
  };
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest',
      map[status] ?? 'bg-muted text-muted-foreground border-border'
    )}>
      {status}
    </span>
  );
}

export function TableSessionBillingDialog({
  sessionId: rawSessionId,
  open,
  onOpenChange,
}: {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: resolvedId } = useResolvedSessionId(open ? rawSessionId : null);
  const sessionId = resolvedId || rawSessionId;

  const isFallbackSessionId = React.useMemo(
    () => !!sessionId && sessionId.startsWith('fallback-session:'),
    [sessionId]
  );
  const isValidSessionId = React.useMemo(
    () => isValidUuid(sessionId) || isFallbackSessionId,
    [sessionId]
  );

  const { formatCurrency } = useSettingsContext();
  const { activeStaff, activeShift } = useStaffSession();
  const { data: hotelInfo } = useHotelInfo();
  const attachCustomerToSession = useAssignCustomerToTableSession();
  const recordPayment = useRecordHotelTablePayment();

  const billingQueryEnabled = open && isValidSessionId;

  const isMutating = recordPayment.isPending || attachCustomerToSession.isPending;

  const {
    data: summary,
    isLoading: isSummaryLoading,
    isFetching: isSummaryFetching,
    refetch: refetchSummary,
  } = useTableSessionSummary(sessionId, billingQueryEnabled, {
    refetchIntervalMs: isMutating ? false : 5000,
    refetchOnMount: open ? 'always' : false,
  });

  const {
    data: sessionItems = [],
    isLoading: areItemsLoading,
    refetch: refetchItems,
  } = useTableSessionBillingItems(sessionId, billingQueryEnabled, {
    refetchIntervalMs: isMutating ? false : 5000,
    refetchOnMount: open ? 'always' : false,
  });

  const [paymentMethod, setPaymentMethod] = React.useState('cash');
  const [receiptData, setReceiptData] = React.useState<any>(null);
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null);
  const [showCustomerSelector, setShowCustomerSelector] = React.useState(false);

  const shouldCloseOnPaidRef = React.useRef(false);
  const paymentRequestKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setReceiptData(null);
      setSelectedCustomer(null);
      setShowCustomerSelector(false);
      shouldCloseOnPaidRef.current = false;
      paymentRequestKeyRef.current = null;
    }
  }, [open, sessionId]);

  const getPaymentRequestKey = React.useCallback(() => {
    if (!paymentRequestKeyRef.current) {
      paymentRequestKeyRef.current = crypto.randomUUID();
    }
    return paymentRequestKeyRef.current;
  }, []);

  React.useEffect(() => {
    if (!open || !summary || !shouldCloseOnPaidRef.current) return;
    if (summary.payment_status !== 'paid' && Number(summary.outstanding_amount || 0) > 0) return;
    shouldCloseOnPaidRef.current = false;
    window.setTimeout(() => {
      onOpenChange(false);
    }, 350);
  }, [open, summary, onOpenChange]);

  const receiptCustomer = React.useMemo(() => {
    if (selectedCustomer) {
      return {
        name: selectedCustomer.name,
        phone: selectedCustomer.phone || null,
        email: selectedCustomer.email || null,
        address: selectedCustomer.address || null,
        tin_number: selectedCustomer.tin_number || null,
      };
    }
    const billedItem = sessionItems.find((item) => item.customer_name);
    if (billedItem?.customer_name) {
      return {
        name: billedItem.customer_name,
        phone: billedItem.customer_phone || null,
        email: billedItem.customer_email || null,
        address: billedItem.customer_address || null,
        tin_number: billedItem.customer_tin || null,
      };
    }
    return {
      name: `${summary?.table_number || 'Table'}`,
      phone: null,
      email: null,
      address: null,
      tin_number: null,
    };
  }, [selectedCustomer, sessionItems, summary?.table_number]);

  const orderMovement = React.useMemo(() => {
    const orderMap = new Map<string, {
      orderId: string;
      orderNumber: string;
      createdAt: string;
      itemCount: number;
      totalAmount: number;
    }>();
    sessionItems
      .filter((item) => item.status !== 'cancelled')
      .forEach((item) => {
        const current = orderMap.get(item.order_id) || {
          orderId: item.order_id,
          orderNumber: item.order_number,
          createdAt: item.created_at,
          itemCount: 0,
          totalAmount: 0,
        };
        current.itemCount += Number(item.quantity || 0);
        current.totalAmount += Number(item.total_price || 0);
        if (new Date(item.created_at).getTime() < new Date(current.createdAt).getTime()) {
          current.createdAt = item.created_at;
        }
        orderMap.set(item.order_id, current);
      });
    return Array.from(orderMap.values())
      .map((entry) => ({
        ...entry,
        totalAmount: Number(entry.totalAmount.toFixed(2)),
      }))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [sessionItems]);

  const activityTimeline = React.useMemo(() => {
    if (!summary) return [];
    const timeline: Array<{
      id: string;
      title: string;
      timeLabel: string;
      detail: string;
      icon: typeof Clock3;
      accentClass: string;
    }> = [
      {
        id: `opened-${summary.session_id}`,
        title: `${summary.table_number || 'Table'} session opened`,
        timeLabel: new Date(summary.opened_at).toLocaleString(),
        detail: `${summary.guest_count} guest${summary.guest_count === 1 ? '' : 's'}`,
        icon: Clock3,
        accentClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
      },
    ];
    orderMovement.forEach((order) => {
      timeline.push({
        id: `order-${order.orderId}`,
        title: `Order ${order.orderNumber}`,
        timeLabel: new Date(order.createdAt).toLocaleString(),
        detail: `${order.itemCount} item${order.itemCount === 1 ? '' : 's'} · ${formatCurrency(order.totalAmount)}`,
        icon: UtensilsCrossed,
        accentClass: 'bg-primary/10 text-primary',
      });
    });
    timeline.push({
      id: `status-${summary.session_id}`,
      title: summary.payment_status === 'paid' ? 'Session fully paid' : 'Current payment position',
      timeLabel: `Outstanding ${formatCurrency(Number(summary.outstanding_amount || 0))}`,
      detail: `${formatCurrency(Number(summary.total_paid || 0))} paid from ${formatCurrency(Number(summary.total_amount || 0))}`,
      icon: Activity,
      accentClass:
        summary.payment_status === 'paid'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
          : summary.payment_status === 'partial'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
            : 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
    });
    return timeline;
  }, [formatCurrency, orderMovement, summary]);

  const statCards = React.useMemo(
    () => [
      {
        label: 'Total',
        value: formatCurrency(Number(summary?.total_amount || 0)),
        valueClass: 'text-foreground',
        accentClass: 'border-border/60',
        dotClass: 'bg-slate-400',
      },
      {
        label: 'Paid',
        value: formatCurrency(Number(summary?.total_paid || 0)),
        valueClass: 'text-emerald-600 dark:text-emerald-400',
        accentClass: 'border-emerald-200/80 dark:border-emerald-800/60',
        dotClass: 'bg-emerald-500',
      },
      {
        label: 'Outstanding',
        value: formatCurrency(Number(summary?.outstanding_amount || 0)),
        valueClass: 'text-rose-600 dark:text-rose-400',
        accentClass: 'border-rose-200/80 dark:border-rose-800/60',
        dotClass: 'bg-rose-500',
      },
      {
        label: 'Orders',
        value: String(orderMovement.length),
        valueClass: 'text-primary',
        accentClass: 'border-primary/20',
        dotClass: 'bg-primary',
      },
    ],
    [formatCurrency, orderMovement.length, summary]
  );

  const ensureCustomerAttached = React.useCallback(async () => {
    if (!summary?.session_id || !selectedCustomer) return;
    await attachCustomerToSession.mutateAsync({
      sessionId: summary.session_id,
      customer: selectedCustomer,
    });
  }, [attachCustomerToSession, selectedCustomer, summary?.session_id]);

  const finalizeIfSessionPaid = React.useCallback(
    (result?: { session_fully_paid?: boolean; session_payment_status?: string }) => {
      if (!result?.session_fully_paid && result?.session_payment_status !== 'paid') {
        shouldCloseOnPaidRef.current = true;
        return;
      }
      shouldCloseOnPaidRef.current = false;
      window.setTimeout(() => {
        onOpenChange(false);
      }, 350);
    },
    [onOpenChange]
  );

  const buildReceiptItems = React.useCallback(
    (items: any[], fallbackLabel: string, paidAmount: number): HotelReceiptPrintItem[] => {
      const normalizedItems = items.map((item) => ({
        service: { name: item.name },
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
      }));
      if (normalizedItems.length > 0) return normalizedItems;
      return [{ service: { name: fallbackLabel }, quantity: 1, unit_price: Number(paidAmount || 0) }];
    },
    []
  );

  const printPaymentReceipt = React.useCallback(
    (options: {
      paidAmount: number;
      fallbackLabel: string;
      filteredItems: any[];
      paymentIds?: string[];
    }) => {
      if (!summary || !hotelInfo || options.paidAmount <= 0) return;
      const nextReceiptItems = buildReceiptItems(options.filteredItems, options.fallbackLabel, options.paidAmount);
      const paymentSuffix = options.paymentIds?.[0]?.slice(0, 8).toUpperCase() || Date.now().toString().slice(-6);
      setReceiptData({
        invoiceNumber: `TS-${summary.table_number || 'TABLE'}-${paymentSuffix}`,
        items: nextReceiptItems,
        subtotal: Number(summary.subtotal || 0),
        discount: 0,
        discountAmount: 0,
        taxRate: Number(summary.tax_rate || 0),
        taxAmount: Number(summary.tax_amount || 0),
        total: Number(summary.total_amount || 0),
        depositCreditAmount: Number(summary.deposit_credit_total || 0),
        paymentMethod,
        paidAmount: Number(options.paidAmount || 0),
        changeAmount: 0,
        hotelInfo,
        customer: { ...receiptCustomer },
        showChargeLabel: false,
        saleDate: new Date(),
      });
    },
    [buildReceiptItems, hotelInfo, paymentMethod, receiptCustomer, summary]
  );

  const assertPaymentReady = React.useCallback(
    (): boolean => {
      if (!isValidSessionId) {
        return false;
      }
      if (!summary?.session_id) {
        return false;
      }
      const isSummarySessionValid = isValidUuid(summary.session_id) || summary.session_id.startsWith('fallback-session:');
      if (!isSummarySessionValid) {
        return false;
      }
      return true;
    },
    [isValidSessionId, summary?.session_id]
  );

  const handleTableOrderPayment = async () => {
    if (!assertPaymentReady()) return;
    try {
      await ensureCustomerAttached();
      const paidAmount = Number(summary!.outstanding_amount || 0);
      const result = await recordPayment.mutateAsync({
        sessionId: summary!.session_id,
        paymentMethod,
        staffId: activeStaff?.staff_id || null,
        shiftId: activeShift?.id || null,
        notes: 'Full table payment',
        idempotencyKey: getPaymentRequestKey(),
      });
      printPaymentReceipt({
        paidAmount,
        fallbackLabel: `${summary!.table_number || 'Table'}`,
        filteredItems: sessionItems.filter((item) => item.status !== 'cancelled'),
        paymentIds: result?.payment_ids,
      });
      finalizeIfSessionPaid(result);
    } catch (error) {
      console.error('Full table payment failed:', error);
    }
  };

  const handleRetryOpen = () => {
    void refetchSummary?.();
    void refetchItems?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="
        flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden
        border-0 bg-background p-0
        sm:h-[92dvh] sm:w-[96vw] sm:max-w-4xl
        sm:rounded-2xl sm:border sm:border-border/60
        sm:shadow-2xl sm:shadow-black/10
      ">

        {/* Header */}
        <div className="relative shrink-0 border-b border-border/60 bg-background px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-primary/40 via-primary to-primary/40" />

          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-base font-semibold sm:text-lg">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Receipt className="h-4 w-4 text-primary" />
              </span>
              Table Billing
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              {summary
                ? `${summary.table_number || 'Table'} · ${summary.guest_count} guest${summary.guest_count === 1 ? '' : 's'} · `
                : 'Manage table payment'}
              {summary && <StatusBadge status={summary.payment_status} />}
            </DialogDescription>
          </DialogHeader>

          {isFallbackSessionId && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200/60 bg-amber-50/80 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs leading-relaxed">
                <strong className="font-semibold">Offline Mode</strong> — Payments recorded locally will sync automatically.
              </p>
            </div>
          )}
        </div>

        {/* Controls */}
        {isValidSessionId && (
          <div className="shrink-0 border-b border-border/60 bg-muted/20 px-4 py-3.5 sm:px-6">
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {statCards.map((card) => (
                  <div
                    key={card.label}
                    className={cn(
                      'group relative overflow-hidden rounded-xl border bg-background px-3.5 py-3 transition-shadow hover:shadow-sm',
                      card.accentClass
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn('h-1.5 w-1.5 rounded-full', card.dotClass)} />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                        {card.label}
                      </p>
                    </div>
                    <p className={cn('mt-1.5 text-lg font-bold tabular-nums leading-none sm:text-xl', card.valueClass)}>
                      {card.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                    Payment method
                  </Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="h-9 rounded-lg border-border/60 bg-muted/30 text-xs font-semibold uppercase tracking-wider transition-colors hover:border-border focus:ring-1 focus:ring-primary/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border/60">
                      {PAYMENT_METHODS.map((method) => (
                        <SelectItem
                          key={method.value}
                          value={method.value}
                          className="rounded-lg text-xs font-semibold uppercase tracking-wider"
                        >
                          <div className="flex items-center gap-2">
                            <method.icon className="h-3.5 w-3.5 text-muted-foreground" />
                            {method.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {(selectedCustomer?.name || receiptCustomer.name || 'W').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {selectedCustomer?.name || receiptCustomer.name || 'Walk-in customer'}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {selectedCustomer?.phone || receiptCustomer.phone || 'No contact on file'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-8 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] border-border/60 bg-muted/20"
                    disabled={isMutating}
                    onClick={() => setShowCustomerSelector(true)}
                  >
                    <User className="mr-1.5 h-3.5 w-3.5" />
                    Change
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4 pb-28 sm:p-6 sm:pb-32">

            {!isValidUuid(sessionId) && !isFallbackSessionId ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-200/60 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/30">
                  <AlertTriangle className="h-7 w-7 text-amber-500" />
                </div>
                <p className="text-sm font-semibold text-foreground">Session not ready</p>
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  This table's session hasn't finished syncing.
                </p>
                <div className="mt-6 flex gap-2.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg border-border/60 text-xs font-semibold"
                    onClick={handleRetryOpen}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Retry
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg text-xs font-semibold text-muted-foreground"
                    onClick={() => onOpenChange(false)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : billingQueryEnabled && (isSummaryLoading || areItemsLoading || (!summary && isSummaryFetching)) ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary/60" />
                <p className="text-sm font-semibold text-foreground">Resolving session...</p>
              </div>
            ) : !summary ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-sm font-semibold text-foreground">Session not available</p>
              </div>
            ) : (
              <div className="space-y-10">
                <section className="space-y-4">
                  <SectionDivider icon={Activity} label="Session Details" />

                  <div className="grid gap-4">
                    <div className="rounded-2xl border border-border/60 bg-background p-4 sm:p-5">
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        {[
                          { label: 'Orders', value: orderMovement.length },
                          {
                            label: 'Items',
                            value: sessionItems
                              .filter((item) => item.status !== 'cancelled')
                              .reduce((sum, item) => sum + Number(item.quantity || 0), 0),
                          },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-lg bg-muted/40 p-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
                            <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</p>
                          </div>
                        ))}
                      </div>

                      {orderMovement.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                            Order list
                          </p>
                          <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1 sm:max-h-[280px]">
                            {orderMovement.map((order) => (
                              <div
                                key={order.orderId}
                                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 transition-colors hover:bg-muted/40"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold text-foreground">{order.orderNumber}</p>
                                  <p className="truncate text-[10px] text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-xs font-bold tabular-nums text-foreground">{formatCurrency(order.totalAmount)}</p>
                                  <p className="text-[10px] text-muted-foreground">{order.itemCount} items</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-background p-4 sm:p-5">
                      <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
                        Activity
                      </p>
                      <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1 sm:max-h-[360px]">
                        {activityTimeline.map((entry, index) => {
                          const Icon = entry.icon;
                          const isLast = index === activityTimeline.length - 1;
                          return (
                            <div key={entry.id} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <div className={cn(
                                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                                  entry.accentClass
                                )}>
                                  <Icon className="h-3.5 w-3.5" />
                                </div>
                                {!isLast && <div className="mt-1 h-full w-px bg-border/60" />}
                              </div>
                              <div className="min-w-0 pb-4">
                                <p className="text-xs font-semibold text-foreground">{entry.title}</p>
                                <p className="text-[10px] text-muted-foreground">{entry.timeLabel}</p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground/80">{entry.detail}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <SectionDivider icon={Receipt} label="Bill Summary" />
                  <div className="rounded-2xl border border-border/60 bg-background p-4 sm:p-5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Subtotal</p>
                        <p className="text-sm font-bold tabular-nums text-foreground">
                          {formatCurrency(Number(summary?.subtotal || 0))}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                          Tax ({summary?.tax_rate || 0}%)
                        </p>
                        <p className="text-sm font-bold tabular-nums text-foreground">
                          {formatCurrency(Number(summary?.tax_amount || 0))}
                        </p>
                      </div>
                      <div className="mt-2 border-t border-border/60 pt-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground">Total</p>
                          <p className="text-lg font-black tabular-nums text-primary">
                            {formatCurrency(Number(summary?.total_amount || 0))}
                          </p>
                        </div>
                        {Number(summary?.deposit_credit_total || 0) > 0 && (
                          <div className="mt-2 flex items-center justify-between">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">Deposit Paid</p>
                            <p className="text-sm font-bold tabular-nums text-sky-700">
                              -{formatCurrency(Number(summary?.deposit_credit_total || 0))}
                            </p>
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Payments Posted</p>
                          <p className="text-sm font-bold tabular-nums text-emerald-700">
                            {formatCurrency(Number(summary?.total_paid || 0))}
                          </p>
                        </div>
                        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">Balance Due</p>
                          <p className="text-base font-black tabular-nums text-rose-600">
                            {formatCurrency(Number(summary?.outstanding_amount || 0))}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <SectionDivider icon={UtensilsCrossed} label="Items" />

                  <div className="overflow-hidden rounded-2xl border border-border/60 bg-background">
                    <div className="p-4 sm:p-5">
                      <div className="mt-4 space-y-2">
                        <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                          {sessionItems.filter((item) => item.status !== 'cancelled').length > 0 ? (
                            sessionItems.filter((item) => item.status !== 'cancelled').map((item) => (
                              <div
                                key={item.item_id}
                                className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-[11px] transition-colors hover:bg-muted/40"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-foreground">
                                    {item.quantity}× {item.name}
                                  </p>
                                  {item.notes && (
                                    <p className="mt-0.5 text-[10px] text-muted-foreground">{item.notes}</p>
                                  )}
                                </div>
                                <span className="shrink-0 font-bold tabular-nums text-foreground">
                                  {formatCurrency(Number(item.total_price || 0))}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center text-xs text-muted-foreground">
                              No items found.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {Number(summary.outstanding_amount || 0) > 0 && (
                      <div className="border-t border-border/60 p-3 sm:p-4">
                        <Button
                          className="h-10 w-full rounded-xl text-[10px] font-semibold uppercase tracking-[0.18em]"
                          disabled={isMutating}
                          onClick={handleTableOrderPayment}
                        >
                          {recordPayment.isPending
                            ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            : <Wallet className="mr-2 h-3.5 w-3.5" />}
                          Collect Payment · {formatCurrency(Number(summary.outstanding_amount || 0))}
                        </Button>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex shrink-0 items-center justify-end border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-lg px-5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-background hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>

        {receiptData && (
          <HotelReceiptPrint
            key={`${receiptData.invoiceNumber || 'receipt'}-${String(receiptData.saleDate || '')}-${receiptData.total || 0}`}
            {...receiptData}
            onPrintComplete={() => setReceiptData(null)}
          />
        )}

        <HotelCustomerSelectorDialog
          open={showCustomerSelector}
          onOpenChange={setShowCustomerSelector}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={setSelectedCustomer}
        />
      </DialogContent>
    </Dialog>
  );
}
