import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ServiceMenuItem, getActiveServicePrice } from './useServiceMenu';
import type { Customer } from './useCustomers';
import { logShiftAction } from '@/hooks/useHotelShifts';
import { releaseHotelTableIfNoActiveOrders } from './useHotelOrders';
import { recalculateInvoiceTotals, printReceipt } from './useHotelServices';
import { CategoryStationLike, normalizeServiceCategoryName, resolveServiceCategoryStation, inferServiceCategoryStation } from '@/lib/serviceCategoryUtils';
import { deductLocalInventoryForOrderItem } from '@/lib/hotelInventory';
import { apiClient } from "@/integrations/supabase/client";

export interface HotelCartItem {
  id: string;
  service: ServiceMenuItem;
  quantity: number;
  unit_price: number;
  notes?: string;
}

export interface HotelPOSPayment {
  method: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'momo';
  amount: number;
}

type DirectPaymentContext = {
  tableId?: string | null;
  tableNumber?: string | null;
  customer?: Customer | null;
  operationKey?: string | null;
};

export function useHotelPOS(
  hotelTaxRate?: number,
  shiftId?: string | null,
  staffId?: string | null,
  taxInclusive: boolean = false,
  serviceCategories: CategoryStationLike[] = []
) {
  const queryClient = useQueryClient();
  const directPaymentAttemptRef = useRef<{
    operationKey: string;
    orderId: string;
    invoiceId: string;
  } | null>(null);
  const [cart, setCart] = useState<HotelCartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(hotelTaxRate ?? 18); // Use provided rate or default to 18%

  // Sync taxRate if hotelTaxRate changes
  useEffect(() => {
    if (hotelTaxRate !== undefined) {
      setTaxRate(hotelTaxRate);
    }
  }, [hotelTaxRate]);

  const addToCart = useCallback((
    service: ServiceMenuItem,
    quantity: number = 1
  ) => {
    setCart(prev => {
      const existing = prev.find(item =>
        item.service.id === service.id
      );
      const activePrice = getActiveServicePrice(service);
      if (existing) {
        const newQty = existing.quantity + quantity;
        return prev.map(item =>
          item.id === existing.id
            ? {
                ...item,
                quantity: newQty,
                unit_price: activePrice,
              }
            : item
        );
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          service,
          quantity,
          unit_price: activePrice,
        },
      ];
    });
    return true;
  }, []);

  const updateQuantity = useCallback((cartItemId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(item => item.id !== cartItemId));
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.id === cartItemId);

      if (!existing) return prev;

      return prev.map(item =>
        item.id === cartItemId
          ? { ...item, quantity }
          : item
      );
    });
  }, []);

  const updatePrice = useCallback((cartItemId: string, price: number) => {
    setCart(prev => prev.map(item =>
      item.id === cartItemId
        ? { ...item, unit_price: price }
        : item
    ));
  }, []);

  const removeFromCart = useCallback((cartItemId: string) => {
    setCart(prev => prev.filter(item => item.id !== cartItemId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setDiscount(0);
  }, []);

  const subtotal = Number(cart.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toFixed(2));
  const discountAmount = Number(((subtotal * discount) / 100).toFixed(2));
  
  let taxableAmount: number, tax_amount: number, total: number;
  
  if (taxInclusive) {
    total = Number((subtotal - discountAmount).toFixed(2));
    tax_amount = Number((total * (taxRate / (100 + taxRate))).toFixed(2));
    taxableAmount = Number((total - tax_amount).toFixed(2));
  } else {
    taxableAmount = Number((subtotal - discountAmount).toFixed(2));
    tax_amount = Number((taxableAmount * (taxRate / 100)).toFixed(2));
    total = Number((taxableAmount + tax_amount).toFixed(2));
  }

  // Direct payment - instant sale without room charge via hotel_orders lifecycle
  const processDirectPayment = useCallback(async (payments: HotelPOSPayment[], context?: DirectPaymentContext) => {
    if (!shiftId) {
      toast.error('No active shift found. Please open a shift first.');
      return null;
    }

    if (cart.length === 0) return null;

    try {
      const operationKey = context?.operationKey || crypto.randomUUID();
      if (directPaymentAttemptRef.current?.operationKey !== operationKey) {
        directPaymentAttemptRef.current = {
          operationKey,
          orderId: crypto.randomUUID(),
          invoiceId: crypto.randomUUID(),
        };
      }

      const orderId = directPaymentAttemptRef.current.orderId;
      const invoiceId = directPaymentAttemptRef.current.invoiceId;
      const timestamp = new Date().toISOString();
      const effectivePaymentMethod = payments.length > 1 ? 'split' : payments[0].method;
      let resolvedSessionId: string | null = null;
      
      if (context?.tableId || context?.tableNumber) {
        let sessionLookup = apiClient
          .from('hotel_table_sessions')
          .select('id')
          .in('status', ['active', 'partially_paid'])
          .order('opened_at', { ascending: false })
          .limit(1);

        if (context?.tableId) {
          sessionLookup = sessionLookup.eq('table_id', context.tableId);
        } else if (context?.tableNumber) {
          sessionLookup = sessionLookup.eq('table_number', context.tableNumber);
        }

        const { data: activeSession } = await sessionLookup.maybeSingle();
        resolvedSessionId = activeSession?.id || null;
      }
      
      const orderPayload = {
        id: orderId,
        invoice_id: invoiceId,
        customer_id: context?.customer?.id || null,
        customer_name: context?.customer?.name || null,
        customer_phone: context?.customer?.phone || null,
        customer_email: context?.customer?.email || null,
        customer_address: context?.customer?.address || null,
        table_id: context?.tableId || null,
        table_number: context?.tableNumber || null,
        session_id: resolvedSessionId,
        staff_id: staffId || null,
        shift_id: shiftId || null,
        waiter_id: staffId || null,
        status: 'settled',
        kitchen_status: 'pending',
        bar_status: 'pending',
        payment_status: 'paid',
        payment_method: effectivePaymentMethod,
        amount_paid: total,
        subtotal,
        tax_amount,
        discount_amount: discountAmount,
        total_amount: total,
        is_billed: true,
        payment_received_at: timestamp,
        settled_at: timestamp,
        settled_by: staffId || null,
        order_number: `POS-${Date.now().toString().slice(-4)}`,
        created_at: timestamp,
        updated_at: timestamp,
      };

      const invoicePayload = {
        id: invoiceId,
        customer_id: context?.customer?.id || null,
        customer_name: context?.customer?.name || null,
        customer_phone: context?.customer?.phone || null,
        customer_email: context?.customer?.email || null,
        customer_address: context?.customer?.address || null,
        subtotal,
        tax_amount,
        total_amount: total,
        discount_amount: discountAmount,
        shift_id: shiftId || null,
        staff_id: staffId || null,
        payment_status: 'paid',
        payment_method: effectivePaymentMethod as any,
        notes: context?.tableNumber
            ? `Table ${context.tableNumber}`
            : 'Walk-in',
        invoice_number: `INV-POS-${Date.now().toString().slice(-6)}`,
        created_at: timestamp,
        updated_at: timestamp,
      };

      const [localOrders, localInvoices, localPayments] = await Promise.all([
        apiClient.from('hotel_orders').select('*').then(res => res.data || []),
        apiClient.from('hotel_invoices').select('*').then(res => res.data || []),
        apiClient.from('hotel_payments').select('*').then(res => res.data || []),
      ]);

      await Promise.all([
        (localOrders || []).some((entry) => entry.id === orderId)
          ? Promise.resolve()
          : apiClient.from('hotel_orders').insert(orderPayload),
        (localInvoices || []).some((entry) => entry.id === invoiceId)
          ? Promise.resolve()
          : apiClient.from('hotel_invoices').insert(invoicePayload),
      ]);

      // 2. Prepare items. Build with 3-tier station resolve: explicit → categories → infer
      const buildPreparedOrderItems = () => cart.map(item => {
        const explicitStation = (item.service as any)?.station;
        const categoryMatchStation = serviceCategories.find(
          (c) => normalizeServiceCategoryName(c.name) === normalizeServiceCategoryName(item.service.category)
        )?.station;
        const inferred = inferServiceCategoryStation(item.service.category);
        const orderStation = explicitStation || categoryMatchStation || inferred;
        return {
          id: item.id,
          order_id: orderId,
          shift_id: shiftId || null,
          service_item_id: item.service.id,
          name: item.service.name,
          quantity: item.quantity,
          purchase_price: (item.service as any).purchase_price || 0,
          unit_price: item.unit_price,
          total_price: item.quantity * item.unit_price,
          item_type: item.service.category,
          notes: item.notes || null,
          station: orderStation === 'other' ? 'kitchen' : (orderStation as any),
          status: 'pending',
          created_at: timestamp,
          updated_at: timestamp,
        };
      });

      const orderItems = buildPreparedOrderItems();

      const invoiceItems = cart.map(item => ({
        id: item.id,
        invoice_id: invoiceId,
        shift_id: shiftId || null,
        description: item.service.name,
        item_type: item.service.category,
        unit_price: item.unit_price,
        quantity: item.quantity,
        total_price: item.quantity * item.unit_price,
        notes: item.notes || null,
        created_at: timestamp,
        updated_at: timestamp,
      }));

      const [localOrderItems, localInvoiceItems] = await Promise.all([
        apiClient.from('hotel_order_items').select('*').then(res => res.data || []),
        apiClient.from('hotel_invoice_items').select('*').then(res => res.data || []),
      ]);

      // 3. Persist sale artifacts before capturing payment. Also deduct locally for offline. Insert trigger handles server side also deducts on server when online.
      const itemsToInsert = orderItems.filter(item => !(localOrderItems || []).some((entry) => entry.id === item.id));
      await Promise.all([
        ...itemsToInsert
          .map(item => apiClient.from('hotel_order_items').insert(item)),
        ...invoiceItems
          .filter(item => !(localInvoiceItems || []).some((entry) => entry.id === item.id))
          .map(item => apiClient.from('hotel_invoice_items').insert(item)),
      ]);

      // Deduct local inventory for every new inserted items (critical for offline stock accuracy)
      if (itemsToInsert.length > 0) {
        await Promise.all(
          itemsToInsert.map(item => deductLocalInventoryForOrderItem(item))
        );
      }

      await recalculateInvoiceTotals(invoiceId);

      const paymentRows = payments.map((payment, index) => ({
        id: crypto.randomUUID(),
        invoice_id: invoiceId,
        session_id: resolvedSessionId,
        payment_group_id: null,
        seat_id: null,
        amount: Number(payment.amount || 0),
        payment_method: payment.method,
        staff_id: staffId || null,
        shift_id: shiftId || null,
        status: 'posted',
        receipt_no: invoicePayload.invoice_number,
        notes: resolvedSessionId
          ? 'Direct POS payment settled instantly'
          : 'Direct POS payment settled instantly (takeaway/delivery)',
        idempotency_key: `${operationKey}:${index}`,
        created_at: timestamp,
      }));

      await Promise.all(
        paymentRows
          .filter((row) => !(localPayments || []).some((entry: any) => entry.idempotency_key === row.idempotency_key))
          .map((row) => apiClient.from('hotel_payments').insert(row))
      );

      if (resolvedSessionId) {
        await apiClient
          .from('hotel_table_sessions')
          .update({
            payment_status: 'paid',
            status: 'closed',
            closed_at: timestamp,
            updated_at: timestamp,
          })
          .eq('id', resolvedSessionId);
      }

      // Release the table after the direct sale is fully settled.
      if (context?.tableId || context?.tableNumber) {
        await releaseHotelTableIfNoActiveOrders(context?.tableId, context?.tableNumber, orderId, 'free', queryClient);
      }

      queryClient.invalidateQueries({ queryKey: ['hotel-orders'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-orders-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-payments'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-session'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-active-table-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-table-occupancy'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-tables'] });
      queryClient.invalidateQueries({ queryKey: ['service-menu'] });
      directPaymentAttemptRef.current = null;

      return {
        ...invoicePayload,
        payment_status: 'paid',
        payment_method: effectivePaymentMethod as any,
      };
    } catch (error: any) {
      toast.error(`Payment failed: ${error.message}`);
      return null;
    }
  }, [cart, staffId, shiftId, subtotal, tax_amount, discountAmount, total, queryClient, serviceCategories]);

  return {
    cart,
    discount,
    subtotal,
    discountAmount,
    taxRate,
    taxAmount: tax_amount,
    total,
    addToCart,
    updateQuantity,
    updatePrice,
    removeFromCart,
    clearCart,
    setDiscount,
    setTaxRate,
    processDirectPayment,
  };
}
