import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHotelInvoices, useHotelBookings, useHotelInfo, useHotelPayments } from '@/hooks/useHotel';
import { HotelInvoice, HotelBooking } from '@/types/hotel';
import { PaymentDialog } from '@/components/hotel/PaymentDialog';
import { fetchInvoiceWithItems, printReceipt } from '@/hooks/useHotelServices';
import { Search, FileText, Loader2, Printer, DollarSign, CreditCard, Banknote, Building, ClipboardCheck, Smartphone, SplitSquareHorizontal, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CashierSettlements } from './components/CashierSettlements';
import {
  useHandoffOrders,
  useUnsettledOrders,
  useCompleteOrder,
  useCheckInReservationOrder,
  useCancelReservationNoShow,
} from '@/hooks/useHotelOrders';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { useActiveStaffShift } from '@/hooks/useHotelShifts';
import { Layout } from '@/components/layout/Layout';
import { useActiveTableSessions } from '@/hooks/useHotelTableSessions';
import { apiClient } from '@/integrations/supabase/client';
import { TableSessionBillingDialog } from '@/components/hotel/TableSessionBillingDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import PosHandle from './components/PosHandleDialog';
import type { HotelOrder } from '@/types/hotel';
import type { HotelPOSPayment } from '@/hooks/useHotelPOS';
import { buildInvoicePaymentsMap, formatHotelPaymentMethod, getInvoicePaymentSummary } from '@/lib/hotelPayments';
import { isWaiterStaff } from '@/lib/hotelAccess';

const paymentMethodIcons: Record<string, any> = {
  cash: Banknote,
  card: CreditCard,
  momo: Smartphone,
  bank_transfer: Building,
  split: SplitSquareHorizontal,
};

// Fallback component for unknown payment methods
const RwfIcon = () => (
  <span className="text-xs font-bold text-muted-foreground">RWF</span>
);

const getPaymentIcon = (method?: string | null) => {
  if (!method) return RwfIcon;
  return paymentMethodIcons[method] ?? RwfIcon;
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  partial: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

type InvoicePaymentMethodFilter =
  | 'all'
  | 'cash'
  | 'card'
  | 'momo'
  | 'bank_transfer'
  | 'split'
  | 'unsettled';

export default function HotelBilling() {
  const { activeStaff } = useStaffSession();
  const { formatCurrency, receiptSettings, getCurrencySymbol } = useSettingsContext();
  const navigate = useNavigate();
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<InvoicePaymentMethodFilter>('all');
  
  const { data: invoices = [], isLoading: isLoadingInvoices } = useHotelInvoices();
  const { data: hotelPayments = [] } = useHotelPayments();
  const { data: bookings = [], isLoading: isLoadingBookings } = useHotelBookings();
  const { data: hotelInfo } = useHotelInfo();
  const { data: handoffOrders = [] } = useHandoffOrders();
  const { data: activeTableSessions = [] } = useActiveTableSessions();
  const { data: baseUnsettledOrders = [] } = useUnsettledOrders(true, { refetchIntervalMs: 5000 });

  const { data: paidTakeawayOrders = [] } = useQuery({
  queryKey: ['paid-takeaway-orders', activeStaff?.staff_id],
  queryFn: async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data } = await apiClient
      .from('hotel_orders')
      .select('*')
      .in('order_type', ['takeaway', 'delivery', 'reservation'])
      .eq('payment_status', 'paid')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false });
    return (data || []).filter(
      (order: any) => !['settled', 'cancelled'].includes(String(order.status || '').toLowerCase())
    );
  },
    enabled: true,
    staleTime: 0,
    refetchInterval: 5000,
  });

  const unsettledOrders = useMemo(() => {
    const seen = new Set(baseUnsettledOrders.map(o => o.id));
    const merged = [...baseUnsettledOrders];

    (paidTakeawayOrders as any[]).forEach((order) => {
      if (!seen.has(order.id)) {
        merged.push(order);
      }
    });

    return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [baseUnsettledOrders, paidTakeawayOrders]);
  const completeOrder = useCompleteOrder();
  const checkInReservationOrder = useCheckInReservationOrder();
  const cancelReservationNoShow = useCancelReservationNoShow();
  const queryClient = useQueryClient();

  const isLoading = isLoadingInvoices || isLoadingBookings;
  const { data: activeShift } = useActiveStaffShift(activeStaff?.staff_id);
  const [search, setSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<HotelInvoice | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [recoveringSessionId, setRecoveringSessionId] = useState<string | null>(null);
  const [companyProfile, setCompanyProfile] = useState<any>(null);
  

  const [completingOrder, setCompletingOrder] = useState<HotelOrder | null>(null);
  const [showPosHandleDialog, setShowPosHandleDialog] = useState(false);

  // Fetch company profile
  useEffect(() => {
    apiClient
      .from('company_profile')
      .select('company_name, address, phone')
      .maybeSingle()
      .then(({ data }) => setCompanyProfile(data))
      .catch((error) => console.error('Error fetching company profile:', error));
  }, []);

  const pendingSettlementCount = useMemo(() => 
    handoffOrders.length,
    [handoffOrders]
  );
  const invoicePaymentsMap = useMemo(
    () => buildInvoicePaymentsMap(hotelPayments),
    [hotelPayments]
  );

  const handlePrintInvoice = async (invoice: HotelInvoice) => {
    try {
      await printReceipt(invoice.id);
    } catch (error) {
      toast.error('Failed to print receipt');
      console.error('Print error:', error);
    }
  };

  const handlePayInvoice = (invoice: HotelInvoice) => {
    setSelectedInvoice(invoice);
  };

  const handlePosHandleStartOrder = useCallback(async (order: HotelOrder, assignedWaiterId: string) => {
    if (!order.table_id || !order.table_number) {
      toast.error('This reservation is missing its table assignment');
      return;
    }

    const result = await checkInReservationOrder.mutateAsync({
      orderId: order.id,
      assignedWaiterId,
    });

    const assignedWaiterName =
      order.assigned_waiter?.id === assignedWaiterId
        ? `${order.assigned_waiter.first_name} ${order.assigned_waiter.last_name}`.trim()
        : 'the selected waiter';
    const canOpenInCurrentSession =
      !!activeStaff?.staff_id &&
      activeStaff.staff_id === assignedWaiterId &&
      isWaiterStaff(activeStaff);

    if (canOpenInCurrentSession) {
      navigate('/restaurant/pos', {
        state: {
          tableEntry: {
            tableId: result.tableId || order.table_id,
            tableNumber: result.tableNumber || order.table_number,
            staffId: assignedWaiterId,
          },
        },
      });
      toast.success(`Checked in ${order.customer_name || 'reservation'} and opened Table ${order.table_number}`);
      return;
    }

    toast.success(`Checked in ${order.customer_name || 'reservation'} and assigned Table ${order.table_number} to ${assignedWaiterName}`);
  }, [activeStaff, checkInReservationOrder, navigate]);

  const handleReservationNoShow = useCallback(async (order: HotelOrder) => {
    await cancelReservationNoShow.mutateAsync({
      orderId: order.id,
      tableId: order.table_id,
      tableNumber: order.table_number,
    });
  }, [cancelReservationNoShow]);

  const handlePosHandleCompleteOrder = useCallback((orderId: string, payments: HotelPOSPayment[]) => {
    completeOrder.mutate({ orderId, payments });
  }, [completeOrder]);

  const handleOpenBillingSession = async (session: any) => {
    if (!session) return;

    if (!session.is_fallback_session) {
      setSelectedSessionId(session.id);
      return;
    }

    const resolvedTableId = [session.table?.id, session.table_id].find(
      (value) => !!value && !String(value).startsWith('synthetic-table:')
    );

    if (!resolvedTableId) {
      toast.error('This occupied table is visible, but its real table record has not synced yet.');
      return;
    }

    setRecoveringSessionId(session.id);
    try {
      const persistedSession = await openTableSession.mutateAsync({
        tableId: resolvedTableId,
        guestCount: Math.max(Number(session.guest_count || 0), Number(session.seats?.length || 0), 1),
        openedBy: session.opened_by || null,
        openedShiftId: session.opened_shift_id || null,
        notes: session.notes || 'Recovered from occupied table orders while rebuilding the table session.',
      });

      setSelectedSessionId(persistedSession.id);
      toast.success(`Opened billing for ${session.table?.table_number || session.table_number || 'table'}`);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to recover the table session for billing');
    } finally {
      setRecoveringSessionId(null);
    }
  };

  const combinedBillingItems = useMemo(() => {
    // 1. Get all actual invoices
    const items = invoices.map(inv => {
      const paymentSummary = getInvoicePaymentSummary(inv.id, invoicePaymentsMap);

      return {
        id: inv.id,
        type: 'invoice' as const,
        number: inv.invoice_number,
        date: inv.created_at,
        guest: inv.guest,
        customerName: inv.customer_name || null,
        total: Number(inv.total_amount),
        status: inv.payment_status,
        method: paymentSummary.primaryMethod || inv.payment_method,
        paymentBreakdown: paymentSummary.entries,
        original: inv
      };
    });

    // 2. Get active bookings that don't have an invoice yet but have a balance
    const pendingBookings = bookings
      .filter(b => b.status !== 'cancelled' && b.status !== 'checked_out')
      .filter(b => !invoices.some(inv => inv.booking_id === b.id))
      .map(b => ({
        id: b.id,
        type: 'booking' as const,
        number: b.booking_reference,
        date: b.created_at,
        guest: b.guest,
        customerName: null,
        total: Number(b.total_amount),
        status: Number(b.paid_amount) > 0 ? 'partial' : 'pending',
        method: null,
        paymentBreakdown: [],
        original: b
      }));

    return [...items, ...pendingBookings].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [invoices, bookings, invoicePaymentsMap]);

  const filteredItems = combinedBillingItems.filter(item => {
    const searchLower = search.toLowerCase();
    const guestName = item.guest ? `${item.guest.first_name || ''} ${item.guest.last_name || ''}`.toLowerCase() : '';
    const customerName = (item.customerName || '').toLowerCase();
    const number = (item.number || '').toLowerCase();
    const matchesSearch =
      number.includes(searchLower) ||
      guestName.includes(searchLower) ||
      customerName.includes(searchLower);

    const methodMatches =
      paymentMethodFilter === 'all'
        ? true
        : paymentMethodFilter === 'unsettled'
          ? !item.method
          : item.method === paymentMethodFilter ||
            (item.paymentBreakdown || []).some((payment: any) => payment.method === paymentMethodFilter);

    return matchesSearch && methodMatches;
  });

  const totalInvoiceRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
  const totalBookingRevenue = bookings
    .filter(b => b.status !== 'cancelled')
    .reduce((sum, b) => sum + Number(b.paid_amount || 0), 0);

  const totalRevenue = totalInvoiceRevenue + totalBookingRevenue;
  
  const pendingInvoiceAmount = invoices.filter(inv => inv.payment_status === 'pending')
    .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

  const pendingBookingAmount = bookings
    .filter(b => b.status !== 'cancelled' && b.status !== 'checked_out')
    .reduce((sum, b) => sum + (Number(b.total_amount || 0) - Number(b.paid_amount || 0)), 0);
    
  const pendingAmount = pendingInvoiceAmount + pendingBookingAmount;
  const paidAmount = totalRevenue;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Billing & Payments</h1>
          <p className="text-muted-foreground">Manage invoices and process payments</p>
        </div>
      </div>

      <Tabs defaultValue="invoices" className="w-full">
        <TabsList className="grid w-full max-w-[750px] grid-cols-4">
          <TabsTrigger value="invoices" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="table-sessions" className="flex items-center gap-2">
            <SplitSquareHorizontal className="h-4 w-4" />
            Table Sessions
          </TabsTrigger>
          <TabsTrigger value="handoffs" className="flex items-center gap-2 relative">
            <ClipboardCheck className="h-4 w-4" />
            Waiter Handoffs
            {pendingSettlementCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 bg-rose-500 text-white text-[10px] rounded-full flex items-center justify-center animate-pulse border-2 border-white">
                {pendingSettlementCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pos-handle" className="flex items-center gap-2 relative">
            <Receipt className="h-4 w-4" />
            POS Handle
            {unsettledOrders.length > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 bg-amber-500 text-white text-[10px] rounded-full flex items-center justify-center animate-pulse border-2 border-white">
                {unsettledOrders.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <DollarSign className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Revenue</p>
                    <p className="text-2xl font-bold">{formatCurrency(totalRevenue)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <CreditCard className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Paid</p>
                    <p className="text-2xl font-bold">{formatCurrency(paidAmount)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                    <Banknote className="h-5 w-5 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pending</p>
                    <p className="text-2xl font-bold">{formatCurrency(pendingAmount)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by invoice number or guest name..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <Select value={paymentMethodFilter} onValueChange={(value) => setPaymentMethodFilter(value as InvoicePaymentMethodFilter)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Payments</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="momo">Mobile Money</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="split">Split</SelectItem>
                    <SelectItem value="unsettled">Not Settled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-muted-foreground">No invoices or pending bills found</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((item) => {
                      const PaymentIcon = getPaymentIcon(item.method);
                      
                      return (
                        <TableRow key={`${item.type}-${item.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{item.number}</p>
                              {item.type === 'booking' && (
                                <Badge variant="outline" className="text-[10px] uppercase font-bold text-slate-400">Draft</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {format(new Date(item.date), 'MMM dd, yyyy')}
                            </p>
                          </TableCell>
                          <TableCell>
                            {item.customerName || (item.guest ? `${item.guest.first_name} ${item.guest.last_name}` : '-')}
                          </TableCell>
                          <TableCell className="font-bold">{formatCurrency(item.total)}</TableCell>
                          <TableCell>
                            {item.method ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1">
                                  <PaymentIcon className="h-4 w-4" />
                                  <span>{formatHotelPaymentMethod(item.method)}</span>
                                </div>
                                {item.paymentBreakdown?.length > 1 && (
                                  <div className="flex flex-wrap gap-1">
                                    {item.paymentBreakdown.map((payment: any) => (
                                      <Badge key={`${item.id}-${payment.method}`} variant="outline" className="text-[10px] font-medium">
                                        {payment.label}: {formatCurrency(payment.amount)}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">Not settled</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={statusColors[item.status || 'pending']}>
                              {item.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {item.type === 'invoice' ? (
                                <>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => handlePayInvoice(item.original as HotelInvoice)}
                                    disabled={item.status === 'paid'}
                                  >
                                    <CreditCard className="h-4 w-4 mr-1" />
                                    Pay
                                  </Button>
                                  <Button 
                                    variant="outline" 
                                    size="icon"
                                    onClick={() => handlePrintInvoice(item.original as HotelInvoice)}
                                  >
                                    <Printer className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : (
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  className="border-primary text-primary hover:bg-primary/5"
                                  onClick={() => {
                                    toast.info('Go to POS to finalize this bill');
                                  }}
                                >
                                  Finalize Bill
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="table-sessions" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Open Table Sessions</p>
                <p className="text-2xl font-bold">
  {activeTableSessions.filter((s: any) => s.payment_status !== 'paid').length}
</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Tables Pending Payment</p>
                <p className="text-2xl font-bold">
                  {activeTableSessions.filter((session: any) => session.payment_status !== 'paid').length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Partially Paid</p>
                <p className="text-2xl font-bold">
                  {activeTableSessions.filter((session: any) => session.payment_status === 'partial').length}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {activeTableSessions.filter((session: any) => session.payment_status !== 'paid').length === 0 ? (
              <Card className="md:col-span-2 xl:col-span-3">
                <CardContent className="py-10 text-center text-muted-foreground">
                  No active dining table sessions found.
                </CardContent>
              </Card>
            ) : (
              activeTableSessions
  .filter((session: any) => session.payment_status !== 'paid')
  .map((session: any) => {
                const openerName = session.opener
                  ? `${session.opener.first_name} ${session.opener.last_name}`.trim()
                  : 'Unknown waiter';
                const isFallbackSession = !!session.is_fallback_session;
                const canRecoverFallbackSession =
                  isFallbackSession &&
                  [session.table?.id, session.table_id].some(
                    (value) => !!value && !String(value).startsWith('synthetic-table:')
                  );
                const isRecoveringThisSession = recoveringSessionId === session.id;
                const actionLabel = isFallbackSession
                  ? canRecoverFallbackSession
                    ? isRecoveringThisSession
                      ? 'Opening Billing...'
                      : 'View & Recover Session'
                    : 'Waiting For Sync'
                  : session.payment_status === 'partial'
                    ? 'View Partial Paid'
                    : 'View & Manage';
                return (
                  <Card key={session.id}>
                    <CardContent className="space-y-4 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold">{session.table?.table_number || session.table_number}</h3>
                          <p className="text-xs uppercase text-muted-foreground">
                            {session.guest_count} guests
                          </p>
                        </div>
                        <Badge className={statusColors[session.payment_status || 'pending']}>
                          {session.payment_status}
                        </Badge>
                      </div>

                      <div className="space-y-1 text-sm">
                        <p><span className="text-muted-foreground">Waiter:</span> {openerName}</p>
                        <p><span className="text-muted-foreground">Session:</span> {format(new Date(session.opened_at), 'MMM dd, HH:mm')}</p>
                        <p><span className="text-muted-foreground">Seats:</span> {(session.seats || []).length}</p>
                        <p><span className="text-muted-foreground">Bill:</span> {formatCurrency(Number(session.total_amount || 0))}</p>
                        <p><span className="text-muted-foreground">Outstanding:</span> {formatCurrency(Number(session.outstanding_amount || 0))}</p>
                        {isFallbackSession && (
                          <p className="text-xs text-amber-600">
                            Billing is being reconstructed from occupied orders because the saved table session has not appeared yet.
                          </p>
                        )}
                      </div>

                      <Button
                        className="w-full"
                        disabled={isRecoveringThisSession || (isFallbackSession && !canRecoverFallbackSession)}
                        onClick={() => void handleOpenBillingSession(session)}
                      >
                        {isRecoveringThisSession && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {actionLabel}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>

        <TabsContent value="handoffs" className="mt-6">
          <Card className="border-none shadow-none bg-transparent">
            <CardContent className="p-0">
              <CashierSettlements 
                orders={handoffOrders}
                formatCurrency={formatCurrency}
                activeShift={activeShift}
                activeStaff={activeStaff}
              />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="pos-handle" className="mt-6">
          <PosHandle
            unsettledOrders={unsettledOrders}
            formatCurrency={formatCurrency}
            completingOrder={completingOrder}
            setCompletingOrder={setCompletingOrder}
            onCompleteOrder={handlePosHandleCompleteOrder}
            onStartOrder={handlePosHandleStartOrder}
              onCancelReservation={handleReservationNoShow}
            isProcessing={completeOrder.isPending}
          />
        </TabsContent>
      </Tabs>

      {selectedInvoice && (
        <PaymentDialog
          open={!!selectedInvoice}
          onOpenChange={(open) => !open && setSelectedInvoice(null)}
          invoice={selectedInvoice}
        />
      )}

      <TableSessionBillingDialog
        open={!!selectedSessionId}
        onOpenChange={(open) => !open && setSelectedSessionId(null)}
        sessionId={selectedSessionId}
      />
    </div>
    </Layout>
  );
}
