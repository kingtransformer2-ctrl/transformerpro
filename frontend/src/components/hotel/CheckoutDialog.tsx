import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  useGenerateCheckoutInvoice, 
  useProcessPayment, 
  useAddInvoicePayment,
  useUpdateLateCheckoutFee
} from '@/hooks/useHotelServices';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { useActiveStaffShift } from '@/hooks/useHotelShifts';
import { useUpdateBookingStatus, useHotelInfo } from '@/hooks/useHotel';
import { HotelBooking, HotelPaymentMethod } from '@/types/hotel';
import { printHotelInvoice, downloadHotelInvoice } from '@/utils/hotelInvoicePdf';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { 
  Loader2, Receipt, CreditCard, Banknote, Building, DollarSign, 
  Printer, Download, AlertCircle, Plus, Trash
} from 'lucide-react';
import { format, differenceInDays, isAfter } from 'date-fns';
import { toast } from 'sonner';

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: HotelBooking;
}

const paymentMethods = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'momo', label: 'Momo', icon: DollarSign },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Building },
];

export function CheckoutDialog({ open, onOpenChange, booking }: CheckoutDialogProps) {
  const [invoice, setInvoice] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<HotelPaymentMethod>('cash');
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lateFee, setLateFee] = useState<string>('0');
  const [showLateFeeInput, setShowLateFeeInput] = useState(false);
  const paymentRequestKeyRef = useRef<string>(crypto.randomUUID());

  const { activeStaff } = useStaffSession();
  const { data: activeShift } = useActiveStaffShift(activeStaff?.staff_id);

  const generateInvoice = useGenerateCheckoutInvoice();
  const addPayment = useAddInvoicePayment();
  const updateLateFee = useUpdateLateCheckoutFee();
  const updateBookingStatus = useUpdateBookingStatus();
  const { data: hotelInfo } = useHotelInfo();
  const { receiptSettings, getCurrencySymbol } = useSettingsContext();

  const nights = differenceInDays(new Date(booking.check_out_date), new Date(booking.check_in_date));
  const isLate = isAfter(new Date(), new Date(booking.check_out_date));

  const balanceDue = invoice ? (Number(invoice.total_amount) - Number(booking.paid_amount)) : 0;

  const handlePrint = async () => {
    if (invoice) {
      await printHotelInvoice(
        invoice, 
        booking, 
        hotelInfo || undefined, 
        getCurrencySymbol(),
        receiptSettings?.paper_size as any || 'A4',
        receiptSettings?.invoice_style as any || 'formal'
      );
    }
  };

  const handleDownload = async () => {
    if (invoice) {
      await downloadHotelInvoice(
        invoice, 
        booking, 
        hotelInfo || undefined, 
        getCurrencySymbol(),
        receiptSettings?.paper_size as any || 'A4',
        receiptSettings?.invoice_style as any || 'formal'
      );
    }
  };

  useEffect(() => {
    if (open && booking.id && !invoice) {
      paymentRequestKeyRef.current = crypto.randomUUID();
      generateInvoice.mutateAsync({ bookingId: booking.id, shiftId: activeShift?.id || null, staffId: activeStaff?.staff_id || null }).then(setInvoice);
    }
  }, [open, booking.id, activeShift?.id, activeStaff?.staff_id, invoice]);

  useEffect(() => {
    if (invoice) {
      setPaymentAmount(balanceDue.toFixed(2));
    }
  }, [invoice, balanceDue]);

  const handleApplyLateFee = async () => {
    if (!invoice) return;
    await updateLateFee.mutateAsync({ invoiceId: invoice.id, fee: parseFloat(lateFee) || 0 });
    // Refetch invoice to get updated totals
    const updated = await generateInvoice.mutateAsync({ bookingId: booking.id, shiftId: activeShift?.id || null, staffId: activeStaff?.staff_id || null });
    setInvoice(updated);
    setShowLateFeeInput(false);
  };

  const handleAddPayment = async () => {
    if (!activeShift) {
      toast.error('Open a shift before recording payment');
      return;
    }
    if (!invoice) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Invalid payment amount');
      return;
    }

    setIsProcessing(true);
    try {
      await addPayment.mutateAsync({
        invoice_id: invoice.id,
        payment_method: paymentMethod,
        amount,
        shift_id: activeShift.id,
        staff_id: activeStaff?.staff_id || null,
        idempotency_key: `checkout:${booking.id}:invoice:${invoice.id}:payment:${paymentRequestKeyRef.current}`,
      });

      // Refetch invoice to get updated balance
      const updated = await generateInvoice.mutateAsync({ bookingId: booking.id, shiftId: activeShift?.id || null, staffId: activeStaff?.staff_id || null });
      setInvoice(updated);
      paymentRequestKeyRef.current = crypto.randomUUID();
      toast.success('Payment recorded');
    } catch (error) {
      console.error('Payment error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinalCheckout = async () => {
    if (balanceDue > 0.01) {
      toast.error(`Please settle the remaining balance of ${balanceDue.toFixed(2)} first`);
      return;
    }

    setIsProcessing(true);
    try {
      await updateBookingStatus.mutateAsync({
        id: booking.id,
        status: 'checked_out',
        roomStatus: 'dirty',
        shiftId: activeShift?.id || null,
        staffId: activeStaff?.staff_id || null,
      });

      toast.success('Guest checked out. Room status set to DIRTY.');
      onOpenChange(false);
    } catch (error) {
      console.error('Checkout error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const SelectedPaymentIcon = paymentMethods.find(p => p.value === paymentMethod)?.icon || Banknote;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden" aria-describedby={undefined}>
        <DialogHeader className="p-6 border-b shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Receipt className="h-6 w-6 text-primary" />
              Guest Checkout & Final Invoice
            </DialogTitle>
            <Badge variant={booking.status === 'checked_out' ? "secondary" : "default"}>
              {booking.status === 'checked_out' ? 'COMPLETED' : 'PENDING CHECKOUT'}
            </Badge>
          </div>
        </DialogHeader>

        {generateInvoice.isPending || !invoice ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column: Details */}
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold">{booking.guest?.first_name} {booking.guest?.last_name}</p>
                      <p className="text-xs text-muted-foreground">{booking.booking_reference}</p>
                    </div>
                    <Badge variant="outline">{nights} Night(s)</Badge>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Folio Items</p>
                  {isLate && !showLateFeeInput && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={() => setShowLateFeeInput(true)}>
                      <AlertCircle className="h-3 w-3 mr-1" /> Add Late Fee
                    </Button>
                  )}
                </div>
                
                {showLateFeeInput && (
                  <div className="flex items-end gap-2 bg-red-50 p-2 rounded-lg border border-red-100">
                    <div className="flex-1 space-y-1">
                      <Label className="text-[10px]">Late Checkout Fee</Label>
                      <Input type="number" value={lateFee} onChange={e => setLateFee(e.target.value)} className="h-8" />
                    </div>
                    <Button size="sm" className="h-8" onClick={handleApplyLateFee}>Apply</Button>
                  </div>
                )}

                <ScrollArea className="h-[250px] border rounded-lg bg-slate-50/50">
                  <div className="p-3 space-y-2">
                    {invoice.items?.map((item: any) => (
                      <div key={item.id} className="flex justify-between items-start py-2 border-b last:border-0">
                        <div>
                          <p className="text-xs font-medium">{item.description}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.quantity}x ${Number(item.unit_price).toFixed(2)}
                          </p>
                        </div>
                        <span className="text-xs font-mono font-bold">${Number(item.total_price).toFixed(2)}</span>
                      </div>
                    ))}
                    {Number(invoice.late_checkout_fee) > 0 && (
                      <div className="flex justify-between items-center py-2 border-b text-red-600">
                        <span className="text-xs font-bold uppercase">Late Checkout Fee</span>
                        <span className="text-xs font-mono font-bold">${Number(invoice.late_checkout_fee).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* Right Column: Totals & Payment */}
            <div className="space-y-4">
              <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3">
                <div className="flex justify-between text-xs opacity-70">
                  <span>Subtotal</span>
                  <span>${Number(invoice.subtotal).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs opacity-70">
                  <span>Tax (18%)</span>
                  <span>${Number(invoice.tax_amount).toFixed(2)}</span>
                </div>
                <Separator className="bg-white/20" />
                <div className="flex justify-between font-bold text-xl">
                  <span>Grand Total</span>
                  <span className="text-orange-400">${Number(invoice.total_amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-green-400 font-medium">
                  <span>Total Paid</span>
                  <span>-${Number(booking.paid_amount).toFixed(2)}</span>
                </div>
                <Separator className="bg-white/20" />
                <div className="flex justify-between font-black text-2xl">
                  <span>Balance Due</span>
                  <span className={balanceDue > 0 ? "text-red-400" : "text-green-400"}>
                    ${balanceDue.toFixed(2)}
                  </span>
                </div>
              </div>

              {balanceDue > 0 && (
                <div className="p-4 border rounded-xl bg-muted/30 space-y-3">
                  <p className="text-sm font-bold">Record Payment</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Method</Label>
                      <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as HotelPaymentMethod)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map(m => (
                            <SelectItem key={m.value} value={m.value}><div className="flex items-center gap-2"><m.icon className="h-3 w-3" />{m.label}</div></SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Amount</Label>
                      <Input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="h-9" />
                    </div>
                  </div>
                  <Button className="w-full h-9 gap-2" onClick={handleAddPayment} disabled={isProcessing}>
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Payment
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={handlePrint}><Printer className="h-4 w-4 mr-2" /> Print</Button>
                  <Button variant="outline" className="flex-1" onClick={handleDownload}><Download className="h-4 w-4 mr-2" /> PDF</Button>
                </div>
                <Button 
                  className={`w-full h-12 text-lg font-bold ${balanceDue <= 0.01 ? 'bg-green-600 hover:bg-green-700' : 'opacity-50 cursor-not-allowed'}`}
                  onClick={handleFinalCheckout}
                  disabled={isProcessing}
                >
                  {balanceDue <= 0.01 ? 'COMPLETE CHECKOUT' : 'SETTLE BALANCE FIRST'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
