import { memo, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Banknote, CheckSquare, Clock, CreditCard, Loader2, Plus, Search, Smartphone, Trash2, User, UserRound, Building2 } from "lucide-react";
import { useApproveAndSettleOrder } from "@/hooks/useHotelOrders";
import { getOrderBalanceDue } from "@/lib/hotelReservationUtils";
import { formatHotelPaymentMethod, HOTEL_PAYMENT_METHOD_OPTIONS } from "@/lib/hotelPayments";
import type { HotelOrder } from "@/types/hotel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const HANDOFF_STATUS_META = {
  awaiting_approval: {
    label: "AWAITING APPROVAL",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    accentClass: "bg-amber-500",
    buttonLabel: "Approve & Settle Order",
    timeLabel: "Submitted",
  },
  pending_handover: {
    label: "PENDING HANDOVER",
    badgeClass: "bg-purple-50 text-purple-600 border-purple-100",
    accentClass: "bg-purple-500",
    buttonLabel: "Receive & Settle Money",
    timeLabel: "Waiter verified",
  },
} as const;

const METHOD_ICONS: Record<string, any> = {
  cash: Banknote,
  card: CreditCard,
  momo: Smartphone,
  bank_transfer: Building2,
};

type SettlementPayment = {
  id: string;
  method: "cash" | "card" | "momo" | "bank_transfer";
  amount: number;
};

type SettlementMethodFilter = "all" | SettlementPayment["method"] | "split";
type SettlementStatusFilter = "all" | keyof typeof HANDOFF_STATUS_META;

const SETTLEMENT_METHOD_VALUES = new Set<SettlementPayment["method"]>([
  "cash",
  "card",
  "momo",
  "bank_transfer",
]);

interface CashierSettlementsProps {
  orders: HotelOrder[];
  formatCurrency: (v: number) => string;
  activeShift: any;
  activeStaff: any;
}

export const CashierSettlements = memo(({
  orders, formatCurrency, activeShift, activeStaff
}: CashierSettlementsProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [methodFilter, setMethodFilter] = useState<SettlementMethodFilter>("all");
  const [statusFilter, setStatusFilter] = useState<SettlementStatusFilter>("all");
  const [settlingOrder, setSettlingOrder] = useState<HotelOrder | null>(null);
  const [payments, setPayments] = useState<SettlementPayment[]>([]);
  const approveAndSettle = useApproveAndSettleOrder();

  const pendingApprovalOrders = useMemo(() =>
    orders.filter((order) => order.status === "awaiting_approval" || order.status === "pending_handover"),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return pendingApprovalOrders.filter((order) => {
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesMethod = methodFilter === "all" || order.payment_method === methodFilter;
      if (!matchesStatus || !matchesMethod) return false;

      if (!term.trim()) return true;

      const orderNum = order.order_number?.toString().toLowerCase() || "";
      const tableNum = order.table_number?.toString().toLowerCase() || "";
      const roomNum = order.room?.room_number?.toString().toLowerCase() || "";
      const waiterName = `${order.waiter?.first_name || ""} ${order.waiter?.last_name || ""}`.toLowerCase();
      const customerName = String(order.customer_name || "").toLowerCase();
      const paymentMethod = formatHotelPaymentMethod(order.payment_method).toLowerCase();

      return orderNum.includes(term) ||
        tableNum.includes(term) ||
        roomNum.includes(term) ||
        waiterName.includes(term) ||
        customerName.includes(term) ||
        paymentMethod.includes(term);
    });
  }, [methodFilter, pendingApprovalOrders, searchTerm, statusFilter]);

  const totalOutstanding = useMemo(() =>
    pendingApprovalOrders.reduce((sum, order) => sum + getOrderBalanceDue(order), 0),
    [pendingApprovalOrders]
  );
  const filteredOutstanding = useMemo(() =>
    filteredOrders.reduce((sum, order) => sum + getOrderBalanceDue(order), 0),
    [filteredOrders]
  );

  const isApprovalFlow = settlingOrder?.status === "awaiting_approval";
const settlingWaiterName = settlingOrder?.waiter
  ? `${settlingOrder.waiter.first_name || ""} ${settlingOrder.waiter.last_name || ""}`.trim()
  : "Unknown waiter";

const balanceDue = settlingOrder ? getOrderBalanceDue(settlingOrder) : 0;

  const totalAllocated = useMemo(
    () => Number(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0).toFixed(2)),
    [payments]
  );
  const remainingBalance = Number(Math.max(balanceDue - totalAllocated, 0).toFixed(2));
  const isOverAllocated = totalAllocated - balanceDue > 0.01;

  useEffect(() => {
    if (!settlingOrder) {
      setPayments([]);
      return;
    }

    const due = getOrderBalanceDue(settlingOrder);
    const defaultMethod = SETTLEMENT_METHOD_VALUES.has(settlingOrder.payment_method as SettlementPayment["method"])
      ? settlingOrder.payment_method as SettlementPayment["method"]
      : "cash";

    setPayments([
      { id: crypto.randomUUID(), method: defaultMethod, amount: due },
    ]);
  }, [settlingOrder]);

  const handleAddPayment = () => {
    if (!settlingOrder || remainingBalance <= 0) return;
    setPayments((current) => [
      ...current,
      { id: crypto.randomUUID(), method: "card", amount: remainingBalance },
    ]);
  };

  const handleUpdatePayment = (id: string, updates: Partial<SettlementPayment>) => {
    setPayments((current) => current.map((payment) => (
      payment.id === id ? { ...payment, ...updates } : payment
    )));
  };

  const handleRemovePayment = (id: string) => {
    if (payments.length <= 1) return;
    setPayments((current) => current.filter((payment) => payment.id !== id));
  };

  const handleConfirmSettlement = async () => {
    if (!settlingOrder) return;
    if (!activeStaff?.staff_id) {
      toast.error("No cashier is signed in");
      return;
    }

    if (totalAllocated <= 0) {
      toast.error("Enter the amount received before settling");
      return;
    }

    if (Math.abs(totalAllocated - balanceDue) > 0.01) {
      toast.error(`Settlement must match the balance due of ${formatCurrency(balanceDue)}`);
      return;
    }

    await approveAndSettle.mutateAsync({
      orderId: settlingOrder.id,
      cashierId: activeStaff.staff_id,
      shiftId: activeShift?.id || null,
      payments: payments.map((payment) => ({
        method: payment.method,
        amount: Number(payment.amount || 0),
      })),
    });

    setSettlingOrder(null);
  };

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden bg-white font-serif">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Financial Handoff</span>
              <span className="text-[11px] font-bold text-slate-900 tracking-tight border-b border-amber-200/30">PENDING SETTLEMENTS</span>
            </div>
            <div className="text-right">
              <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest block leading-none">
                {filteredOrders.length === pendingApprovalOrders.length ? "Total to Collect" : "Filtered Total"}
              </span>
              <span className="text-sm font-black text-emerald-600 tracking-tighter leading-none">
                {formatCurrency(filteredOrders.length === pendingApprovalOrders.length ? totalOutstanding : filteredOutstanding)}
              </span>
            </div>
          </div>

          <div className="relative group mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="SEARCH BY WAITER, CUSTOMER, ROOM, TABLE..."
              className="h-8 pl-8 pr-3 rounded-xl bg-white border-slate-200 focus:border-emerald-300 focus:ring-0 text-[10px] font-bold uppercase tracking-widest transition-all text-slate-900 placeholder:text-slate-300"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as SettlementStatusFilter)}>
              <SelectTrigger className="h-8 rounded-xl bg-white border-slate-200 text-[10px] font-bold uppercase tracking-widest">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending_handover">Pending Handover</SelectItem>
                <SelectItem value="awaiting_approval">Awaiting Approval</SelectItem>
              </SelectContent>
            </Select>

            <Select value={methodFilter} onValueChange={(value) => setMethodFilter(value as SettlementMethodFilter)}>
              <SelectTrigger className="h-8 rounded-xl bg-white border-slate-200 text-[10px] font-bold uppercase tracking-widest">
                <SelectValue placeholder="Filter method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="momo">Mobile Money</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="split">Split</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="flex-1 p-4 bg-slate-50/30">
          <div className="space-y-3 pb-4">
            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[200px] text-slate-300">
                <Banknote className="h-12 w-12 mb-3 opacity-20" />
                <p className="font-bold text-[9px] uppercase tracking-widest">
                  {searchTerm || methodFilter !== "all" || statusFilter !== "all"
                    ? "No matches found"
                    : "No pending collections"}
                </p>
              </div>
            ) : (
              filteredOrders.map((order) => {
                const statusMeta = HANDOFF_STATUS_META[order.status as keyof typeof HANDOFF_STATUS_META] || HANDOFF_STATUS_META.pending_handover;
                const balance = getOrderBalanceDue(order);

                return (
                  <div
                    key={order.id}
                    className="group relative bg-white border border-slate-200 rounded-2xl overflow-hidden transition-all duration-500 hover:border-emerald-300 hover:shadow-md"
                  >
                    <div className={cn("absolute top-0 left-0 w-1 h-full opacity-70", statusMeta.accentClass)} />

                    <div className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-purple-50 text-purple-600 flex flex-col items-center justify-center shadow-sm border border-purple-100">
                            <span className="text-[7px] font-bold uppercase opacity-70">NODE</span>
                            <span className="text-xs font-bold tracking-tighter">#{order.order_number.toString().slice(-4)}</span>
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-bold text-sm tracking-tight text-slate-900">
                                {order.room?.room_number ? `ROOM ${order.room.room_number}` : `TABLE ${order.table_number || "WI"}`}
                              </h4>
                              <Badge className={cn("px-1.5 py-0 text-[8px] font-bold tracking-widest", statusMeta.badgeClass)}>
                                {statusMeta.label}
                              </Badge>
                            </div>
                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5 flex items-center gap-1.5">
                              <User className="h-2.5 w-2.5 text-slate-400" /> {order.waiter?.first_name} {order.waiter?.last_name}
                            </p>
                            {order.customer_name && (
                              <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest mt-0.5 flex items-center gap-1.5">
                                <UserRound className="h-2.5 w-2.5 text-emerald-400" /> Customer: {order.customer_name}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-sm font-black tracking-tighter text-slate-900 tabular-nums">
                            {formatCurrency(balance)}
                          </span>
                          <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                            {formatHotelPaymentMethod(order.payment_method)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100 mb-3">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-slate-400" />
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                            {statusMeta.timeLabel} {formatDistanceToNow(new Date(order.payment_received_at || order.updated_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>

                      <Button
                        size="sm"
                        disabled={approveAndSettle.isPending}
                        onClick={() => setSettlingOrder(order)}
                        className="w-full h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-100 flex items-center justify-center gap-2"
                      >
                        <CheckSquare className="h-4 w-4" />
                        {statusMeta.buttonLabel}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={!!settlingOrder} onOpenChange={(open) => !open && setSettlingOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
  <DialogTitle>
    {isApprovalFlow ? "Approve Order Settlement" : "Receive Handoff Payment"}
  </DialogTitle>
  <DialogDescription>
    {isApprovalFlow
      ? "The waiter has submitted this order for approval. Confirm the amount received before it's marked settled."
      : "The waiter has already verified this handoff. Allocate the amount actually received by payment method."}
    {" "}This settlement is recorded to the invoice and payment report.
  </DialogDescription>
</DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
  <div className="rounded-xl border bg-slate-50 p-4">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Waiter</p>
    <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-900">
      <User className="h-3.5 w-3.5 text-slate-400" />
      {settlingWaiterName}
    </p>
  </div>
  <div className="rounded-xl border bg-slate-50 p-4">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Order</p>
    <p className="mt-1 text-sm font-bold text-slate-900">#{settlingOrder?.order_number}</p>
  </div>
  <div className="rounded-xl border bg-slate-50 p-4">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Customer</p>
    <p className="mt-1 text-sm font-bold text-slate-900">{settlingOrder?.customer_name || "Walk-in"}</p>
  </div>
  <div className="rounded-xl border bg-slate-50 p-4">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Balance Due</p>
    <p className="mt-1 text-sm font-bold text-emerald-700">{formatCurrency(balanceDue)}</p>
  </div>
</div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Payment Breakdown
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddPayment}
                  disabled={remainingBalance <= 0}
                  className="h-7 text-[11px] font-bold uppercase text-primary"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Split
                </Button>
              </div>

              <div className="space-y-3">
                {payments.map((payment) => {
                  const MethodIcon = METHOD_ICONS[payment.method] || Banknote;

                  return (
                    <div key={payment.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600">
                        <MethodIcon className="h-5 w-5" />
                      </div>

                      <div className="grid flex-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-semibold uppercase text-slate-500">Method</Label>
                          <Select
                            value={payment.method}
                            onValueChange={(value) => handleUpdatePayment(payment.id, { method: value as SettlementPayment["method"] })}
                          >
                            <SelectTrigger className="h-9 bg-white border-slate-200 text-xs font-semibold">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {HOTEL_PAYMENT_METHOD_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value} className="text-xs font-medium">
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[10px] font-semibold uppercase text-slate-500">Amount</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
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
                  );
                })}
              </div>
            </div>

            <div className={cn(
              "rounded-xl border p-4",
              isOverAllocated
                ? "border-rose-200 bg-rose-50"
                : remainingBalance > 0
                  ? "border-amber-200 bg-amber-50"
                  : "border-emerald-200 bg-emerald-50"
            )}>
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="uppercase tracking-[0.14em] text-slate-500">
                  {isOverAllocated ? "Over allocated" : remainingBalance > 0 ? "Remaining balance" : "Settlement ready"}
                </span>
                <span className={cn(
                  isOverAllocated ? "text-rose-700" : remainingBalance > 0 ? "text-amber-700" : "text-emerald-700"
                )}>
                  {isOverAllocated
                    ? formatCurrency(totalAllocated - balanceDue)
                    : remainingBalance > 0
                      ? formatCurrency(remainingBalance)
                      : formatCurrency(totalAllocated)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlingOrder(null)}>
              Cancel
            </Button>
            <Button
  onClick={() => void handleConfirmSettlement()}
  disabled={approveAndSettle.isPending || totalAllocated <= 0 || Math.abs(totalAllocated - balanceDue) > 0.01}
  className="bg-emerald-600 hover:bg-emerald-700"
>
  {approveAndSettle.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
  {isApprovalFlow ? "Approve & Settle" : "Confirm Settlement"}
</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

CashierSettlements.displayName = "CashierSettlements";
