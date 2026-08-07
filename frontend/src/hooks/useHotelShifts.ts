import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isBackendTransientError, apiClient, withApiTimeout } from '@/integrations/supabase/client';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { HotelStaffShift } from '@/types/hotel';
import { toast } from 'sonner';
import { isManagerLikeStaff, isWaiterStaff } from '@/lib/hotelAccess';
import { syncService } from '@/lib/syncService';

const SHIFT_RPC_TIMEOUT_MS = 6000;

export async function logShiftAction(params: {
  shiftId: string | null | undefined;
  staffId?: string | null;
  actionType: string;
  description?: string | null;
  amount?: number | null;
  referenceId?: string | null;
}) {
  if (!params.shiftId) return null;

  await syncService.performOperation('hotel_shift_logs', 'insert', {
    id: crypto.randomUUID(),
    shift_id: params.shiftId,
    staff_id: params.staffId || null,
    action_type: params.actionType,
    description: params.description || null,
    amount: params.amount ?? null,
    reference_id: params.referenceId || null,
    created_at: new Date().toISOString(),
  });

  return true;
}

export async function recordShiftTransaction(params: {
  shiftId: string | null | undefined;
  staffId?: string | null;
  type: 'cash' | 'momo' | 'card' | 'upi' | 'bank_transfer' | 'refund' | 'void' | 'room_charge' | 'handover' | 'split';
  amount: number;
  referenceId?: string | null;
}) {
  if (!params.shiftId) return null;

  await syncService.performOperation('hotel_shift_transactions', 'insert', {
    id: crypto.randomUUID(),
    shift_id: params.shiftId,
    staff_id: params.staffId || null,
    type: params.type,
    amount: params.amount,
    reference_id: params.referenceId || null,
    created_at: new Date().toISOString(),
  });

  return true;
}

export function useActiveStaffShift(staffId?: string) {
  return useQuery({
    queryKey: ['hotel-shifts', 'active', staffId],
    queryFn: async () => {
      if (!staffId) return null;
      const { data, error } = await apiClient
        .from('hotel_staff_shifts')
        .select('*')
        .eq('staff_id', staffId)
        .is('closed_at', null)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching active shift:', error);
        throw error;
      }
      return data as HotelStaffShift | null;
    },
    enabled: !!staffId,
    staleTime: 1000 * 60 * 5, 
    retry: 2,
  });
}

export function useStaffShifts(staffId?: string) {
  const { activeStaff } = useStaffSession();
  const scopedStaffId = isWaiterStaff(activeStaff) ? activeStaff?.staff_id : staffId;

  return useQuery({
    queryKey: ['hotel-shifts', scopedStaffId, activeStaff?.staff_id, activeStaff?.role],
    queryFn: async () => {
      let query = apiClient
        .from('hotel_staff_shifts')
        .select('*, staff:hotel_staff(id, first_name, last_name, role)')
        .order('opened_at', { ascending: false });
      if (scopedStaffId) {
        query = query.eq('staff_id', scopedStaffId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as HotelStaffShift[];
    },
  });
}

export function useShiftDetails(shiftId?: string) {
  const { activeStaff } = useStaffSession();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!shiftId) return;

    const logsSubscription = apiClient
      .channel(`shift-logs-${shiftId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hotel_shift_logs', filter: `shift_id=eq.${shiftId}` },
        () => queryClient.invalidateQueries({ queryKey: ['hotel-shift-details', shiftId] })
      )
      .subscribe();

    const txSubscription = apiClient
      .channel(`shift-transactions-${shiftId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hotel_shift_transactions', filter: `shift_id=eq.${shiftId}` },
        () => queryClient.invalidateQueries({ queryKey: ['hotel-shift-details', shiftId] })
      )
      .subscribe();

    const shiftSubscription = apiClient
      .channel(`shift-update-${shiftId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'hotel_staff_shifts', filter: `id=eq.${shiftId}` },
        () => queryClient.invalidateQueries({ queryKey: ['hotel-shift-details', shiftId] })
      )
      .subscribe();

    return () => {
      apiClient.removeChannel(logsSubscription);
      apiClient.removeChannel(txSubscription);
      apiClient.removeChannel(shiftSubscription);
    };
  }, [shiftId, queryClient]);

  return useQuery({
    queryKey: ['hotel-shift-details', shiftId, activeStaff?.staff_id, activeStaff?.role],
    queryFn: async () => {
      if (!shiftId) return null;
      
      const [shiftRes, logsRes, transactionsRes] = await Promise.all([
        apiClient.from('hotel_staff_shifts').select('*, staff:hotel_staff(id, first_name, last_name, role)').eq('id', shiftId).single(),
        apiClient.from('hotel_shift_logs').select('*').eq('shift_id', shiftId).order('created_at', { ascending: true }),
        apiClient.from('hotel_shift_transactions').select('*').eq('shift_id', shiftId).order('created_at', { ascending: true })
      ]);

      if (shiftRes.error) throw shiftRes.error;
      if (!isManagerLikeStaff(activeStaff) && shiftRes.data?.staff_id !== activeStaff?.staff_id) {
        throw new Error('You are not allowed to view another staff shift');
      }

      return {
        shift: shiftRes.data,
        logs: logsRes.data || [],
        transactions: transactionsRes.data || []
      };
    },
    enabled: !!shiftId
  });
}

export function useCurrentShiftSummary() {
  const { activeShift } = useStaffSession();
  
  return useQuery({
    queryKey: ['hotel-shift-current-summary', activeShift?.id],
    queryFn: async () => {
      if (!activeShift?.id) return null;

      const [txRes, ordersRes] = await Promise.all([
        apiClient.from('hotel_shift_transactions').select('type, amount').eq('shift_id', activeShift.id),
        apiClient.from('hotel_orders').select('status, total_amount').eq('shift_id', activeShift.id),
      ]);

      const transactions = txRes.data || [];
      const orders = ordersRes.data || [];

      const financial = {
        cash: transactions.filter(t => t.type === 'cash').reduce((sum, t) => sum + Number(t.amount), 0),
        momo: transactions.filter(t => t.type === 'momo').reduce((sum, t) => sum + Number(t.amount), 0),
        card: transactions.filter(t => t.type === 'card').reduce((sum, t) => sum + Number(t.amount), 0),
        upi: transactions.filter(t => t.type === 'upi').reduce((sum, t) => sum + Number(t.amount), 0),
        total_sales: orders.filter(o => o.status === 'settled').reduce((sum, o) => sum + Number(o.total_amount), 0),
      };

      return {
        financial,
        orderCount: orders.length,
        activeOrders: orders.filter(o => ['pending', 'preparing', 'ready'].includes(o.status)).length,
      };
    },
    enabled: !!activeShift?.id,
    refetchInterval: 30000,
  });
}

export function useShiftSummaryPreview(shiftId?: string) {
  const { activeStaff } = useStaffSession();

  return useQuery({
    queryKey: ['hotel-shift-summary-preview', shiftId, activeStaff?.staff_id, activeStaff?.role],
    queryFn: async () => {
      if (!shiftId) return null;

      const [shiftRes, txRes, ordersRes, orderItemsRes, logsRes, stockMovesRes] = await Promise.all([
        apiClient.from('hotel_staff_shifts').select('*').eq('id', shiftId).single(),
        apiClient.from('hotel_shift_transactions').select('type, amount').eq('shift_id', shiftId),
        apiClient.from('hotel_orders').select('id, status, total_amount, order_number, table_number, room_id, created_at, invoice:hotel_invoices(payment_status)').eq('shift_id', shiftId),
        apiClient.from('hotel_order_items').select('quantity, name, category, unit_price').eq('shift_id', shiftId),
        apiClient.from('hotel_shift_logs').select('action_type, description, amount').eq('shift_id', shiftId),
        apiClient.from('hotel_stock_movements').select('quantity, item_id, movement_type').eq('shift_id', shiftId)
      ]);

      if (shiftRes.error) throw shiftRes.error;
      if (!isManagerLikeStaff(activeStaff) && shiftRes.data?.staff_id !== activeStaff?.staff_id) {
        throw new Error('You are not allowed to view another staff shift summary');
      }

      const transactions = txRes.data || [];
      const orders = ordersRes.data || [];
      const orderItems = orderItemsRes.data || [];
      const logs = logsRes.data || [];
      const stockMoves = stockMovesRes.data || [];
      const shift = shiftRes.data;

      const totalSales = transactions.filter((t: any) => !['refund', 'void', 'handover'].includes(t.type)).reduce((sum, t: any) => sum + Number(t.amount || 0), 0);
      const cashSales = transactions.filter((t: any) => t.type === 'cash').reduce((sum, t: any) => sum + Number(t.amount || 0), 0);
      const refundsVoids = transactions.filter((t: any) => t.type === 'refund' || t.type === 'void').reduce((sum, t: any) => sum + Number(t.amount || 0), 0);
      const handovers = transactions.filter((t: any) => t.type === 'handover').reduce((sum, t: any) => sum + Number(t.amount || 0), 0);
      const momoSales = transactions.filter((t: any) => t.type === 'momo').reduce((sum, t: any) => sum + Number(t.amount || 0), 0);
      const cardSales = transactions.filter((t: any) => ['card', 'upi', 'bank_transfer'].includes(t.type)).reduce((sum, t: any) => sum + Number(t.amount || 0), 0);
      const roomCharges = transactions.filter((t: any) => t.type === 'room_charge').reduce((sum, t: any) => sum + Number(t.amount || 0), 0);

      const openingCash = Number(shift.opening_cash || 0);
      const expectedCash = openingCash + cashSales + refundsVoids + handovers;

      const totalOrders = orders.length;
      const completedOrders = orders.filter((o: any) => o.status === 'settled').length;
      const cancelledOrders = orders.filter((o: any) => o.status === 'cancelled');
      const pendingOrders = orders.filter((o: any) => ['pending', 'preparing', 'ready', 'served', 'awaiting_approval', 'pending_handover'].includes(o.status));

      const totalItemsCount = orderItems.reduce((sum, i: any) => sum + Number(i.quantity || 0), 0);

      const categorySales = orderItems.reduce((acc: Record<string, { qty: number, total: number }>, item: any) => {
        const cat = item.category || 'uncategorized';
        if (!acc[cat]) acc[cat] = { qty: 0, total: 0 };
        acc[cat].qty += Number(item.quantity || 0);
        acc[cat].total += Number(item.quantity || 0) * Number(item.unit_price || 0);
        return acc;
      }, {});

      const stationSales = {
        kitchen: { qty: 0, total: 0 },
        bar: { qty: 0, total: 0 },
        inventory: { qty: 0, total: 0 },
        other: { qty: 0, total: 0 }
      };
      
      (orderItems || []).forEach((item: any) => {
        const cat = (item.category || '').toLowerCase();
        let station: keyof typeof stationSales = 'other';
        if (cat.includes('food') || cat.includes('meal') || cat.includes('kitchen') || cat.includes('snack')) {
          station = 'kitchen';
        } else if (cat.includes('drink') || cat.includes('beverage') || cat.includes('bar') || cat.includes('wine') || cat.includes('beer')) {
          station = 'bar';
        } else if (cat.includes('inventory') || cat.includes('retail') || cat.includes('merch')) {
          station = 'inventory';
        }
        stationSales[station].qty += Number(item.quantity || 0);
        stationSales[station].total += (Number(item.quantity || 0) * Number(item.unit_price || 0));
      });

      const unpaidOrders = orders.filter((o: any) => (o.status === 'billed' || o.status === 'awaiting_approval' || o.status === 'pending_handover') && (!o.invoice || o.invoice.payment_status !== 'paid'));
      const roomOrders = orders.filter((o: any) => !!o.room_id);
      const tableOrders = orders.filter((o: any) => !!o.table_number);

      const activityCounts = logs.reduce((acc: Record<string, number>, log: any) => {
        acc[log.action_type] = (acc[log.action_type] || 0) + 1;
        return acc;
      }, {});

      const inventoryMoves = stockMoves.reduce((acc: Record<string, { name: string, qty: number }>, move: any) => {
        const itemId = move.service_item_id || move.item_id;
        if (!acc[itemId]) acc[itemId] = { name: move.service_item?.name || 'Unknown Item', qty: 0 };
        if (move.movement_type === 'out') acc[itemId].qty += Number(move.quantity || 0);
        return acc;
      }, {});

      return {
        financial: {
          opening_cash: openingCash,
          total_sales: totalSales,
          cash_sales: cashSales,
          momo_sales: momoSales,
          card_sales: cardSales,
          room_charges: roomCharges,
          handovers: handovers,
          expected_cash: expectedCash,
        },
        orders: {
          total_orders: totalOrders,
          completed_orders: completedOrders,
          cancelled_orders: cancelledOrders.length,
          pending_orders: pendingOrders.length,
          room_service_orders: roomOrders.length,
          table_orders: tableOrders.length,
          cancelled_details: cancelledOrders.map((o: any) => ({
            order_number: o.order_number,
            reason: o.cancel_reason,
            amount: o.total_amount
          })),
          unpaid_details: unpaidOrders.map((o: any) => ({
            order_number: o.order_number,
            amount: o.total_amount,
            status: o.status
          }))
        },
        stations: stationSales,
        categories: categorySales,
        hotel_activity: {
          rooms_booked: activityCounts.booking_created || activityCounts.reservation_created || 0,
          check_ins: activityCounts.check_in || 0,
          check_outs: activityCounts.check_out || 0,
          service_orders: activityCounts.order_created || 0,
          payments_processed: activityCounts.payment_approved || activityCounts.direct_payment || 0,
        },
        inventory: {
          total_items_sold: stockMoves.filter((m: any) => m.movement_type === 'out').reduce((sum, m: any) => sum + Number(m.quantity || 0), 0),
          top_items: Object.values(inventoryMoves).sort((a, b) => b.qty - a.qty).slice(0, 5),
        },
      };
    },
    enabled: !!shiftId
  });
}

// Helper to safely extract shift from RPC response
// The RPC open_hotel_staff_shift may return a UUID string or a full shift object
async function resolveShiftFromRpcData(data: any): Promise<HotelStaffShift> {
  if (!data) throw new Error('No shift data returned from RPC');

  // If it's a plain UUID string
  if (typeof data === 'string') {
    const { data: shiftData, error } = await apiClient
      .from('hotel_staff_shifts')
      .select('*')
      .eq('id', data)
      .single();
    if (error) throw error;
    return shiftData as HotelStaffShift;
  }

  // If it's an object with an id field (full shift object)
  if (typeof data === 'object' && data !== null && typeof data.id === 'string') {
    return data as HotelStaffShift;
  }

  throw new Error(`Unexpected RPC response format: ${JSON.stringify(data)}`);
}

export function useOpenStaffShift() {
  const queryClient = useQueryClient();
  const { activeStaff } = useStaffSession();
  
  return useMutation({
    mutationFn: async (params: {
      shiftLabel: string;
      openingCash?: number;
      openingNotes?: string;
    }) => {
      console.log('Opening shift via secure RPC:', params);

      if (!activeStaff?.staff_id || !activeStaff?.role) {
        throw new Error('Staff session is missing. Please sign in with PIN again.');
      }

      const rpcPayload = {
        p_staff_id: activeStaff.staff_id,
        p_staff_role: activeStaff.role,
        p_shift_label: params.shiftLabel || 'general',
        p_opening_cash: params.openingCash || 0,
        p_opening_notes: params.openingNotes || null
      };

      let data: unknown = null;
      let error: any = null;

      try {
        const rpcResult = await withApiTimeout(
          apiClient.rpc('open_hotel_staff_shift' as any, rpcPayload),
          SHIFT_RPC_TIMEOUT_MS,
          'Open shift'
        );
        data = rpcResult.data;
        error = rpcResult.error;
      } catch (rpcError) {
        if (isBackendTransientError(rpcError as any)) {
          const fallbackResult = await withApiTimeout(
            apiClient
              .from('hotel_staff_shifts')
              .select('*')
              .eq('staff_id', activeStaff.staff_id)
              .is('closed_at', null)
              .maybeSingle(),
            SHIFT_RPC_TIMEOUT_MS,
            'Fetch active shift after open timeout'
          );

          if (fallbackResult.data) {
            return fallbackResult.data as HotelStaffShift;
          }

          throw new Error('Open shift request timed out. Please retry once.');
        }

        throw rpcError;
      }

      if (error) {
        console.error('RPC shift opening failed:', error);
        
        if (error.status === 403 || error.code === '42501') {
          toast.error('Session Error: You may need to log out and log back in to refresh your security token.');
        }

        // Fallback: if shift already exists, return it
        if (error.code === '23505' || error.message?.includes('already has an open shift')) {
          const { data: existing } = await apiClient
            .from('hotel_staff_shifts')
            .select('*')
            .eq('staff_id', activeStaff.staff_id)
            .is('closed_at', null)
            .maybeSingle();
          if (existing) return existing as HotelStaffShift;
        }
        
        throw error;
      }

      return await resolveShiftFromRpcData(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-shifts'] });
      toast.success('Work session initiated');
    },
    onError: (error: Error) => {
      console.error('Shift mutation error:', error);
      toast.error(`Shift Error: ${error.message}`);
    },
  });
}

export function useCloseStaffShift() {
  const queryClient = useQueryClient();
  const { logoutStaff } = useStaffSession();

  return useMutation({
    mutationFn: async (params: {
      shiftId: string;
      closingCash: number;
      closingNotes?: string;
      forceClose?: boolean;
    }) => {
      console.log('Closing shift via secure RPC:', params);

      const { data, error } = await apiClient.rpc('close_hotel_staff_shift' as any, {
        p_shift_id: params.shiftId,
        p_closing_cash: params.closingCash,
        p_closing_notes: params.closingNotes || null,
        p_force_close: params.forceClose || false
      });

      if (error) {
        console.error('RPC shift closing failed:', error);
        throw error;
      }

      return await resolveShiftFromRpcData(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-shifts'] });
      toast.success('Shift closed successfully');
      logoutStaff();
    },
    onError: (error: Error) => {
      console.error('Shift close error:', error);
      toast.error(`Close Error: ${error.message}`);
    },
  });
}

export function useReviewShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ shiftId }: { shiftId: string }) => {
      const { data, error } = await apiClient
        .from('hotel_staff_shifts')
        .update({ status: 'REVIEWED' })
        .eq('id', shiftId)
        .select()
        .single();

      if (error) throw error;
      return data as HotelStaffShift;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-shifts'] });
      toast.success('Shift reviewed');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
