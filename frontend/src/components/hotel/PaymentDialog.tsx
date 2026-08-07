import { useState, useMemo, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProcessPayment, useAddInvoicePayment } from '@/hooks/useHotelServices';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { HotelInvoice, HotelPaymentMethod } from '@/types/hotel';
import { 
  Loader2, CreditCard, Banknote, Building, 
  DollarSign, CheckCircle, Plus, Trash2, 
  AlertCircle, Smartphone, Calculator 
} from 'lucide-react';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: HotelInvoice;
}

interface PaymentEntry {
  id: string;
  method: HotelPaymentMethod;
  amount: number;
  reference?: string;
}

const paymentMethods = [
  { value: 'cash', label: 'Cash', icon: Banknote, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { value: 'card', label: 'Card', icon: CreditCard, color: 'text-blue-600', bg: 'bg-blue-50' },
  { value: 'momo', label: 'Momo', icon: Smartphone, color: 'text-rose-500', bg: 'bg-rose-50' },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Building, color: 'text-amber-600', bg: 'bg-amber-50' },
  { value: 'room_charge', label: 'Room Charge', icon: Building, color: 'text-indigo-600', bg: 'bg-indigo-50' },
];

export function PaymentDialog({ open, onOpenChange, invoice }: PaymentDialogProps) {
  const { formatCurrency } = useSettingsContext();
  const { activeStaff, activeShift } = useStaffSession();
  
  const [payments, setPayments] = useState<PaymentEntry[]>([
    { id: crypto.randomUUID(), method: 'cash', amount: Number(invoice.total_amount) }
  ]);
  
  const [cashReceived, setCashReceived] = useState<number>(0);
  const totalDue = Number(invoice.total_amount);

  const totalAllocated = useMemo(() => 
    payments.reduce((sum, p) => sum + p.amount, 0),
  [payments]);

  const remainingBalance = Math.max(0, totalDue - totalAllocated);
  const isOverpaid = totalAllocated > totalDue;
  
  // Calculate change ONLY for cash if it's the only method or if we want to be fancy
  // For simplicity: If there's a cash payment, and totalAllocated >= totalDue, 
  // and user entered "cashReceived", calculate change.
  const cashPayment = payments.find(p => p.method === 'cash');
  const changeDue = cashReceived > 0 ? Math.max(0, cashReceived - (cashPayment?.amount || 0)) : 0;

  const processPayment = useProcessPayment();
  const addPayment = useAddInvoicePayment();
  const singlePaymentKeyRef = useRef<string>(crypto.randomUUID());

  // Reset payments when dialog opens with a new invoice
  useEffect(() => {
    if (open) {
      setPayments([{ id: crypto.randomUUID(), method: 'cash', amount: Number(invoice.total_amount) }]);
      setCashReceived(0);
      singlePaymentKeyRef.current = crypto.randomUUID();
    }
  }, [open, invoice.id, invoice.total_amount]);

  const handleAddPayment = () => {
    if (remainingBalance <= 0) return;
    setPayments([...payments, { 
      id: crypto.randomUUID(), 
      method: 'card', 
      amount: remainingBalance 
    }]);
  };

  const handleRemovePayment = (id: string) => {
    if (payments.length <= 1) return;
    setPayments(payments.filter(p => p.id !== id));
  };

  const handleUpdatePayment = (id: string, updates: Partial<PaymentEntry>) => {
    setPayments(payments.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handleProcess = async () => {
    if (totalAllocated < totalDue) {
      toast.error(`Please allocate the full amount: ${formatCurrency(remainingBalance)} remaining`);
      return;
    }

    if (!activeShift?.id) {
      toast.error("You must have an open shift to process payments");
      return;
    }

    try {
      // If there are multiple payments, record each one
      if (payments.length > 1) {
        for (const payment of payments) {
          await addPayment.mutateAsync({
            invoice_id: invoice.id,
            payment_method: payment.method,
            amount: payment.amount,
            shift_id: activeShift.id,
            staff_id: activeStaff?.staff_id,
            idempotency_key: `invoice:${invoice.id}:payment:${payment.id}`,
          });
        }
      } else {
        // Single payment can use the standard process
        await processPayment.mutateAsync({
          invoiceId: invoice.id,
          paymentMethod: payments[0].method,
          amountPaid: payments[0].amount,
          shiftId: activeShift.id,
          staffId: activeStaff?.staff_id,
          idempotencyKey: `invoice:${invoice.id}:single:${singlePaymentKeyRef.current}`,
        });
      }
      
      onOpenChange(false);
    } catch (err) {
      // Error handled by mutation
    }
  };

  const isPaid = invoice.payment_status === 'paid';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden border-none shadow-2xl" aria-describedby={undefined}>
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 text-white">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  <CreditCard className="h-6 w-6 text-rose-400" />
                  Settle Invoice
                </DialogTitle>
                <DialogDescription className="text-slate-400 text-xs font-medium uppercase tracking-wider">
                  #{invoice.invoice_number} • {invoice.guest?.first_name} {invoice.guest?.last_name}
                </DialogDescription>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Subtotal: {formatCurrency(invoice.subtotal)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tax: {formatCurrency(invoice.tax_amount)}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">Total Due</p>
                <p className="text-3xl font-black text-rose-400 tabular-nums">
                  {formatCurrency(totalDue)}
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="p-6 space-y-6 bg-white">
          {isPaid ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="h-10 w-10 text-emerald-600" />
              </div>
              <div className="text-center">
                <h3 className="text-xl font-bold text-slate-900">Payment Completed</h3>
                <p className="text-slate-500 text-sm">This invoice has already been settled.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Payment Breakdown */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Payment Breakdown</Label>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleAddPayment}
                    disabled={remainingBalance <= 0}
                    className="h-7 text-[10px] font-bold uppercase text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add Split
                  </Button>
                </div>

                <div className="space-y-3">
                  {payments.map((payment, index) => {
                    const methodInfo = paymentMethods.find(m => m.value === payment.method);
                    const MethodIcon = methodInfo?.icon || Banknote;
                    
                    return (
                      <div key={payment.id} className="group relative flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50 transition-all hover:border-rose-200 hover:bg-white hover:shadow-sm">
                        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-inner", methodInfo?.bg, methodInfo?.color)}>
                          <MethodIcon className="h-5 w-5" />
                        </div>
                        
                        <div className="flex-1 grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-[9px] font-bold uppercase text-slate-400">Method</Label>
                            <Select 
                              value={payment.method} 
                              onValueChange={(v) => handleUpdatePayment(payment.id, { method: v as HotelPaymentMethod })}
                            >
                              <SelectTrigger className="h-9 bg-white border-slate-200 text-xs font-semibold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {paymentMethods.map(m => (
                                  <SelectItem key={m.value} value={m.value} className="text-xs font-medium">
                                    {m.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="space-y-1">
                            <Label className="text-[9px] font-bold uppercase text-slate-400">Amount</Label>
                            <div className="relative">
                              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                              <Input
                                type="number"
                                value={payment.amount}
                                onChange={(e) => handleUpdatePayment(payment.id, { amount: parseFloat(e.target.value) || 0 })}
                                className="h-9 pl-7 bg-white border-slate-200 text-xs font-bold tabular-nums"
                              />
                            </div>
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

              {/* Cash Assistant (If cash selected) */}
              {payments.some(p => p.method === 'cash') && (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <Calculator className="h-4 w-4" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Cash Assistant</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-[9px] font-bold uppercase text-emerald-600/70">Cash Received</Label>
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={cashReceived || ''}
                        onChange={(e) => setCashReceived(parseFloat(e.target.value) || 0)}
                        className="h-9 bg-white border-emerald-200 text-xs font-bold tabular-nums focus:ring-emerald-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] font-bold uppercase text-emerald-600/70">Change Due</Label>
                      <div className="h-9 flex items-center px-3 bg-white border border-emerald-200 rounded-md text-sm font-black text-emerald-600 tabular-nums">
                        {formatCurrency(changeDue)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Summary Bar */}
              <div className={cn(
                "p-4 rounded-xl flex items-center justify-between transition-colors",
                isOverpaid ? "bg-amber-50 border border-amber-100" : 
                remainingBalance > 0 ? "bg-slate-100 border border-slate-200" : 
                "bg-emerald-500 text-white"
              )}>
                <div className="flex items-center gap-3">
                  {remainingBalance > 0 ? (
                    <div className="h-8 w-8 rounded-full bg-white/50 flex items-center justify-center">
                      <AlertCircle className="h-4 w-4 text-slate-500" />
                    </div>
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
                      <CheckCircle className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <div>
                    <p className={cn("text-[9px] font-bold uppercase tracking-wider", remainingBalance > 0 ? "text-slate-500" : "text-white/80")}>
                      {remainingBalance > 0 ? "Balance Remaining" : "Status"}
                    </p>
                    <p className="text-sm font-bold">
                      {remainingBalance > 0 ? formatCurrency(remainingBalance) : "Ready to Settle"}
                    </p>
                  </div>
                </div>
                
                {isOverpaid && (
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-tight">
                    Overpaid by {formatCurrency(totalAllocated - totalDue)}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="p-6 bg-slate-50 border-t border-slate-100">
          <Button 
            variant="ghost" 
            onClick={() => onOpenChange(false)}
            className="text-xs font-bold uppercase tracking-widest text-slate-500"
          >
            {isPaid ? 'Close' : 'Cancel'}
          </Button>
          {!isPaid && (
            <Button 
              onClick={handleProcess} 
              disabled={processPayment.isPending || totalAllocated < totalDue}
              className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-200 disabled:opacity-50 transition-all active:scale-95"
            >
              {processPayment.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              <span className="text-xs font-bold uppercase tracking-widest">Complete Settlement</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
