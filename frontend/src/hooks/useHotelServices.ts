import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { HotelInvoice, HotelPaymentMethod } from '@/types/hotel';
import { toast } from 'sonner';
import { logShiftAction, recordShiftTransaction } from '@/hooks/useHotelShifts';
import { getLocalData, getLocalItem, saveLocalData } from '@/lib/localDataService';
import { syncService } from '@/lib/syncService';
import { printHtmlDocument } from '@/utils/printHtmlDocument';
import { summarizePaymentMethods, formatHotelPaymentMethod } from '@/lib/hotelPayments';

export interface InvoiceItem {
  id: string;
  invoice_id?: string;
  booking_id?: string;
  description: string;
  item_type: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
}

type RecordHotelInvoicePaymentParams = {
  invoiceId: string;
  paymentMethod: HotelPaymentMethod;
  amountPaid: number;
  shiftId?: string | null;
  staffId?: string | null;
  sessionId?: string | null;
  seatId?: string | null;
  paymentGroupId?: string | null;
  receiptNo?: string | null;
  transactionReference?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
};

export async function recordHotelInvoicePayment(params: RecordHotelInvoicePaymentParams) {
  let paymentId: string;
  if (params.idempotencyKey) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    paymentId = uuidPattern.test(params.idempotencyKey)
      ? params.idempotencyKey
      : crypto.randomUUID();
  } else {
    paymentId = crypto.randomUUID();
  }

  // Get current invoice
  let invoice = await getLocalItem<HotelInvoice>('hotel_invoices', params.invoiceId);
  if (!invoice && navigator.onLine) {
    const { data } = await apiClient
      .from('hotel_invoices')
      .select('*')
      .eq('id', params.invoiceId)
      .single();
    invoice = data;
  }

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // FIX: hotel_payments does NOT have updated_at - removed it entirely
  const paymentRecord = {
    id: paymentId,
    invoice_id: params.invoiceId,
    session_id: params.sessionId || null,
    seat_id: params.seatId || null,
    payment_group_id: params.paymentGroupId || null,
    payment_method: params.paymentMethod,
    amount: params.amountPaid,
    transaction_reference: params.transactionReference || null,
    staff_id: params.staffId || null,
    shift_id: params.shiftId || null,
    receipt_no: params.receiptNo || null,
    status: 'posted',
    notes: params.notes || null,
    created_at: new Date().toISOString(),
    // NO updated_at here - column does not exist in hotel_payments table
  };

  await syncService.performOperation('hotel_payments', 'insert', paymentRecord);

  // Calculate total paid so far
  let localPayments = await getLocalData<any>('hotel_payments');
  let invoicePayments = (localPayments || []).filter(
    (p: any) => p.invoice_id === params.invoiceId
  );

  if (invoicePayments.length === 0 && navigator.onLine) {
    const { data } = await apiClient
      .from('hotel_payments')
      .select('*')
      .eq('invoice_id', params.invoiceId);
    invoicePayments = data || [];
  }

  if (!invoicePayments.some((payment: any) => payment.id === paymentId)) {
    invoicePayments = [...invoicePayments, paymentRecord];
  }

  const totalPaid = invoicePayments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const outstandingAmount = Number(invoice.total_amount) - totalPaid;
  const paymentSummary = summarizePaymentMethods(invoicePayments as any);
  // Use small epsilon to handle floating point
  const paymentStatus = totalPaid <= 0 ? 'pending' : outstandingAmount <= 0.01 ? 'paid' : 'partial';

  // hotel_invoices DOES have updated_at - safe to include
  await syncService.performOperation('hotel_invoices', 'update', {
    id: params.invoiceId,
    payment_status: paymentStatus,
    payment_method: (paymentSummary.primaryMethod || params.paymentMethod) as HotelPaymentMethod,
    updated_at: new Date().toISOString(),
  });

  return {
    success: true,
    invoice_id: params.invoiceId,
    payment_id: paymentId,
    payment_status: paymentStatus,
    total_paid: totalPaid,
    outstanding_amount: Math.max(outstandingAmount, 0),
  };
}

export async function printReceipt(invoiceId: string) {
  const invoiceWithItems = await fetchInvoiceWithItems(invoiceId);
  const allPayments = await getLocalData<any>('hotel_payments');
  let invoicePayments = (allPayments || []).filter((payment: any) => payment.invoice_id === invoiceId);

  if (invoicePayments.length === 0 && navigator.onLine) {
    const { data } = await apiClient
      .from('hotel_payments')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true });
    invoicePayments = data || [];
  }

  const paymentSummary = summarizePaymentMethods(invoicePayments as any);

  let companyProfile = await getLocalItem<any>('company_profile', 'current');
  if (!companyProfile && navigator.onLine) {
    const { data } = await apiClient
      .from('company_profile')
      .select('company_name, address, phone')
      .single();
    companyProfile = {
      id: 'current',
      company_name: data.company_name,
      address: data.address,
      phone: data.phone
    };
    await saveLocalData('company_profile', [companyProfile]);
  }

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const receiptHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Receipt</title>
      <style>
        body { font-family: monospace; font-size: 12px; max-width: 300px; margin: 0 auto; padding: 10px; }
        .header { text-align: center; margin-bottom: 10px; }
        .divider { border-top: 1px dashed #000; margin: 5px 0; }
        .item-row { display: flex; justify-content: space-between; }
        .total-row { font-weight: bold; margin-top: 5px; }
        .footer { text-align: center; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h3>${escapeHtml(companyProfile?.company_name || 'Restaurant')}</h3>
        <p>${escapeHtml(companyProfile?.address || '')}</p>
        ${companyProfile?.phone ? `<p>${escapeHtml(companyProfile.phone)}</p>` : ''}
        <p>${escapeHtml(new Date().toLocaleString())}</p>
      </div>
      <div class="divider"></div>
      <div>
        <p>Invoice: ${escapeHtml(invoiceWithItems.invoice_number || '')}</p>
        <p>Walk-in Guest</p>
      </div>
      <div class="divider"></div>
      <div>
        ${(invoiceWithItems.items || []).map((item: any) => `
          <div class="item-row">
            <span>${Number(item.quantity || 0)}x ${escapeHtml(item.description || '')}</span>
            <span>RF ${Number(item.unit_price).toFixed(0)}</span>
          </div>
          <div style="text-align: right;">RF ${Number(item.total_price).toFixed(0)}</div>
        `).join('')}
      </div>
      <div class="divider"></div>
      <div>
        <div class="item-row"><span>Subtotal</span><span>RF ${Number(invoiceWithItems.subtotal).toFixed(0)}</span></div>
        <div class="item-row"><span>Tax (18%)</span><span>RF ${Number(invoiceWithItems.tax_amount).toFixed(0)}</span></div>
        ${Number(invoiceWithItems.discount_amount) > 0
          ? `<div class="item-row"><span>Discount</span><span>-RF ${Number(invoiceWithItems.discount_amount).toFixed(0)}</span></div>`
          : ''}
        <div class="total-row item-row"><span>Total</span><span>RF ${Number(invoiceWithItems.total_amount).toFixed(0)}</span></div>
      </div>
      <div class="divider"></div>
      <div>
        <p>Payment Method: ${escapeHtml(formatHotelPaymentMethod(paymentSummary.primaryMethod || invoiceWithItems.payment_method || ''))}</p>
        ${paymentSummary.entries.length > 1
          ? paymentSummary.entries.map((entry) => `
            <div class="item-row">
              <span>${escapeHtml(entry.label)}</span>
              <span>RF ${Number(entry.amount).toFixed(0)}</span>
            </div>
          `).join('')
          : ''}
      </div>
      <div class="divider"></div>
      <div class="footer"><p>Thank you for visiting!</p></div>
    </body>
    </html>
  `;

  await printHtmlDocument({
    html: receiptHTML,
    title: `Invoice-${invoiceWithItems.invoice_number || invoiceId}`,
    afterPrintFallbackMs: 10000,
    resourceLoadTimeoutMs: 10000,
  });
}

export function useInvoiceItems(bookingId: string) {
  return useQuery({
    queryKey: ['invoice-items', bookingId],
    queryFn: async () => {
      const allLocalItems = await getLocalData<InvoiceItem>('hotel_invoice_items');
      const allLocalInvoices = await getLocalData<HotelInvoice>('hotel_invoices');
      const invoice = allLocalInvoices.find(inv => inv.booking_id === bookingId);

      if (invoice) {
        const items = allLocalItems.filter(item => item.invoice_id === invoice.id);
        if (items.length > 0) return items;
      }

      const { data: remoteInvoice } = await apiClient
        .from('hotel_invoices')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle();

      if (remoteInvoice) {
        const { data, error } = await apiClient
          .from('hotel_invoice_items')
          .select('*')
          .eq('invoice_id', remoteInvoice.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (data) await saveLocalData('hotel_invoice_items', data);
        return data as InvoiceItem[];
      }
      return [] as InvoiceItem[];
    },
    enabled: !!bookingId,
  });
}

export function useAddInvoiceItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: {
      booking_id: string;
      description: string;
      item_type: string;
      unit_price: number;
      quantity: number;
      total_price: number;
      service_item_id?: string;
      shift_id?: string | null;
      staff_id?: string | null;
    }) => {
      let { data: existingInvoice } = await apiClient
        .from('hotel_invoices')
        .select('id')
        .eq('booking_id', item.booking_id)
        .maybeSingle();

      let invoiceId = existingInvoice?.id;

      if (!invoiceId) {
        const { data: booking } = await apiClient
          .from('hotel_bookings')
          .select('guest_id')
          .eq('id', item.booking_id)
          .single();

        const { data: newInvoice, error: invoiceError } = await apiClient
          .from('hotel_invoices')
          .insert([{
            booking_id: item.booking_id,
            guest_id: booking?.guest_id,
            shift_id: item.shift_id || null,
            staff_id: item.staff_id || null,
            subtotal: 0,
            tax_amount: 0,
            total_amount: 0,
            payment_status: 'pending',
            invoice_number: '',
          }])
          .select()
          .single();

        if (invoiceError) throw invoiceError;
        invoiceId = newInvoice.id;
      }

      if (invoiceId && item.shift_id) {
        await apiClient
          .from('hotel_invoices')
          .update({ shift_id: item.shift_id, staff_id: item.staff_id || null })
          .eq('id', invoiceId)
          .is('shift_id', null);
      }

      const { data, error } = await apiClient
        .from('hotel_invoice_items')
        .insert([{
          invoice_id: invoiceId,
          shift_id: item.shift_id || null,
          description: item.description,
          item_type: item.item_type,
          unit_price: item.unit_price,
          quantity: item.quantity,
          total_price: item.total_price,
        }])
        .select()
        .single();

      if (error) throw error;
      await recalculateInvoiceTotals(invoiceId);
      await logShiftAction({
        shiftId: item.shift_id,
        staffId: item.staff_id || undefined,
        actionType: 'service_added',
        description: item.description,
        amount: item.total_price,
        referenceId: invoiceId,
      });

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoice-items', variables.booking_id] });
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      toast.success('Service added successfully');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteInvoiceItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const { data: item } = await apiClient
        .from('hotel_invoice_items')
        .select('invoice_id')
        .eq('id', itemId)
        .single();

      const { error } = await apiClient
        .from('hotel_invoice_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;
      if (item?.invoice_id) await recalculateInvoiceTotals(item.invoice_id);
      return item?.invoice_id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-items'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      toast.success('Service removed');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useGenerateCheckoutInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ bookingId, shiftId, staffId }: { bookingId: string; shiftId?: string | null; staffId?: string | null }) => {
      const { data: booking, error: bookingError } = await apiClient
        .from('hotel_bookings')
        .select('*, room:hotel_rooms(*)')
        .eq('id', bookingId)
        .single();

      if (bookingError) throw bookingError;

      const checkIn = new Date(booking.check_in_date);
      const checkOut = new Date(booking.check_out_date);
      const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
      const roomCharge = Number(booking.room?.price_per_night || 0) * nights;

      let { data: existingInvoice } = await apiClient
        .from('hotel_invoices')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle();

      let invoiceId = existingInvoice?.id;

      if (!invoiceId) {
        const { data: newInvoice, error: invoiceError } = await apiClient
          .from('hotel_invoices')
          .insert([{
            booking_id: bookingId,
            guest_id: booking.guest_id,
            shift_id: shiftId || null,
            staff_id: staffId || null,
            subtotal: 0,
            tax_amount: 0,
            total_amount: 0,
            payment_status: 'pending',
            invoice_number: '',
          }])
          .select()
          .single();

        if (invoiceError) throw invoiceError;
        invoiceId = newInvoice.id;
      }

      const { data: existingRoomCharge } = await apiClient
        .from('hotel_invoice_items')
        .select('id')
        .eq('invoice_id', invoiceId)
        .eq('item_type', 'room')
        .maybeSingle();

      if (!existingRoomCharge) {
        await apiClient.from('hotel_invoice_items').insert([{
          invoice_id: invoiceId,
          shift_id: shiftId || null,
          description: `Room ${booking.room?.room_number} - ${nights} night(s)`,
          item_type: 'room',
          unit_price: booking.room?.price_per_night || 0,
          quantity: nights,
          total_price: roomCharge,
        }]);
      }

      await recalculateInvoiceTotals(invoiceId);

      const { data: finalInvoice } = await apiClient
        .from('hotel_invoices')
        .select('*, items:hotel_invoice_items(*)')
        .eq('id', invoiceId)
        .single();

      return finalInvoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-items'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useProcessPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      invoiceId, paymentMethod, amountPaid, shiftId, staffId, idempotencyKey,
    }: {
      invoiceId: string;
      paymentMethod: HotelPaymentMethod;
      amountPaid: number;
      shiftId?: string | null;
      staffId?: string | null;
      idempotencyKey?: string | null;
    }) => {
      const paymentResult = await recordHotelInvoicePayment({
        invoiceId, paymentMethod, amountPaid, shiftId, staffId, idempotencyKey,
      });

      const { data: invoice, error } = await apiClient
        .from('hotel_invoices')
        .select('*')
        .eq('id', paymentResult.invoice_id)
        .single();

      if (error) throw error;
      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-payments'] });
      toast.success('Payment processed successfully');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<HotelInvoice> & { id: string }) => {
      const { data, error } = await apiClient
        .from('hotel_invoices')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      toast.success('Invoice updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface HotelPayment {
  id: string;
  invoice_id: string;
  payment_method: HotelPaymentMethod;
  amount: number;
  transaction_reference?: string;
  created_at: string;
}

export function useAddInvoicePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payment: {
      invoice_id: string;
      payment_method: HotelPaymentMethod;
      amount: number;
      transaction_reference?: string;
      shift_id?: string | null;
      staff_id?: string | null;
      notes?: string | null;
      idempotency_key?: string | null;
    }) => {
      return recordHotelInvoicePayment({
        invoiceId: payment.invoice_id,
        paymentMethod: payment.payment_method,
        amountPaid: payment.amount,
        shiftId: payment.shift_id || null,
        staffId: payment.staff_id || null,
        transactionReference: payment.transaction_reference || null,
        notes: payment.notes || null,
        idempotencyKey: payment.idempotency_key || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-payments'] });
      toast.success('Payment recorded');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateLateCheckoutFee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ invoiceId, fee }: { invoiceId: string; fee: number }) => {
      const { error } = await apiClient
        .from('hotel_invoices')
        .update({ late_checkout_fee: fee })
        .eq('id', invoiceId);

      if (error) throw error;
      await recalculateInvoiceTotals(invoiceId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      toast.success('Late checkout fee updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export async function recalculateInvoiceTotals(invoiceId: string) {
  const { data: items } = await apiClient
    .from('hotel_invoice_items')
    .select('total_price')
    .eq('invoice_id', invoiceId);

  const { data: invoice } = await apiClient
    .from('hotel_invoices')
    .select('late_checkout_fee, discount_amount')
    .eq('id', invoiceId)
    .single();

  const { data: hotelInfo } = await apiClient
    .from('hotel_info')
    .select('tax_rate, tax_inclusive')
    .limit(1)
    .maybeSingle();

  const subtotal = Number((items || []).reduce((sum, item) => sum + Number(item.total_price), 0).toFixed(2));
  const taxRate = Number(hotelInfo?.tax_rate || 18);
  const taxInclusive = hotelInfo?.tax_inclusive ?? false;

  let taxAmount: number, totalAmount: number;
  const discountAmount = Number(Number(invoice?.discount_amount || 0).toFixed(2));
  const lateCheckoutFee = Number(Number(invoice?.late_checkout_fee || 0).toFixed(2));

  if (taxInclusive) {
    const totalBeforeFees = Number((subtotal - discountAmount).toFixed(2));
    taxAmount = Number((totalBeforeFees * (taxRate / (100 + taxRate))).toFixed(2));
    totalAmount = Number((totalBeforeFees + lateCheckoutFee).toFixed(2));
  } else {
    const taxableAmount = Number((subtotal - discountAmount).toFixed(2));
    taxAmount = Number((taxableAmount * (taxRate / 100)).toFixed(2));
    totalAmount = Number((taxableAmount + taxAmount + lateCheckoutFee).toFixed(2));
  }

  await apiClient
    .from('hotel_invoices')
    .update({ subtotal, tax_amount: taxAmount, total_amount: totalAmount })
    .eq('id', invoiceId);
}

export async function fetchInvoiceWithItems(invoiceId: string) {
  const localInvoice = await getLocalItem<HotelInvoice>('hotel_invoices', invoiceId);
  const allLocalItems = await getLocalData<InvoiceItem>('hotel_invoice_items');
  const localItems = allLocalItems.filter(item => item.invoice_id === invoiceId);

  if (localInvoice && localItems.length > 0) {
    return { ...localInvoice, items: localItems };
  }

  const { data: invoice, error } = await apiClient
    .from('hotel_invoices')
    .select('*, guest:hotel_guests(*), booking:hotel_bookings(*, room:hotel_rooms(*))')
    .eq('id', invoiceId)
    .single();

  if (error) throw error;

  const { data: items } = await apiClient
    .from('hotel_invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at');

  return { ...invoice, items: items || [] };
}
