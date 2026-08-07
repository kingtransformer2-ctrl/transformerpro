import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHotelDashboard, useHotelBookings, useHotelRooms, useHotelGuests, useHotelInvoices, useHotelPayments } from "@/hooks/useHotel";
import { useServiceMenu, useWastageLogs } from "@/hooks/useServiceMenu";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from "recharts";
import { Download, TrendingUp, Users, BedDouble, DollarSign, Calendar, Utensils, ThermometerSnowflake, PieChart as PieChartIcon, ArrowRight, Receipt, Banknote, CreditCard, Smartphone, Building2 } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useSettingsContext } from "@/contexts/SettingsContext";
import {
  buildInvoicePaymentsMap,
  filterPaymentsByDateRange,
  formatHotelPaymentMethod,
  getInvoicePaymentSummary,
  getMethodTotal,
} from "@/lib/hotelPayments";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export default function HotelReports() {
  const [dateRange, setDateRange] = useState("30");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const { data: dashboard } = useHotelDashboard();
  const { data: bookings = [] } = useHotelBookings();
  const { data: rooms = [] } = useHotelRooms();
  const { data: guests = [] } = useHotelGuests();
  const { data: invoices = [] } = useHotelInvoices();
  const { data: payments = [] } = useHotelPayments();
  const { data: menuItems = [] } = useServiceMenu();
  const { data: wastageLogs = [] } = useWastageLogs();

  // NOTE: `settings` is pulled from the same context that already provides
  // `formatCurrency`. If your SettingsContext stores the business name under
  // a different field, just update the fallback chain in `businessName` below.
  const { formatCurrency, settings } = useSettingsContext();

  // Try the most common field names businesses use for their saved name.
  // Adjust/trim this list once you confirm the actual field in SettingsContext.
  const businessName =
    settings?.businessName ||
    settings?.hotelName ||
    settings?.companyName ||
    settings?.business_name ||
    settings?.name ||
    "Restaurant";

  const startDate = subDays(new Date(), parseInt(dateRange));
  const endDate = new Date();

  // Filter data by date range
  const filteredBookings = bookings.filter(b => 
    new Date(b.created_at!) >= startDate
  );

  const filteredInvoices = invoices.filter(i => 
    new Date(i.created_at!) >= startDate
  );

  const filteredPayments = useMemo(() => {
    const endDateWithTime = new Date(endDate);
    endDateWithTime.setHours(23, 59, 59, 999);

    const inRange = filterPaymentsByDateRange(payments, startDate, endDateWithTime)
      .filter((payment) => payment.status !== "cancelled" && payment.status !== "void");

    if (paymentMethodFilter === "all") {
      return inRange;
    }

    return inRange.filter((payment) => payment.payment_method === paymentMethodFilter);
  }, [payments, startDate, endDate, paymentMethodFilter]);

  const filteredWastage = wastageLogs.filter(w =>
    new Date(w.created_at!) >= startDate
  );

  // Food Cost & Profit Analysis
  const foodCostData = menuItems
    .filter(item => item.purchase_price > 0)
    .map(item => ({
      name: item.name,
      price: item.selling_price,
      cost: item.purchase_price,
      margin: item.selling_price > 0 ? ((item.selling_price - item.purchase_price) / item.selling_price) * 100 : 0
    }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 10);

  // Wastage Analysis
  const wastageByReason = filteredWastage.reduce((acc: any[], log) => {
    const existing = acc.find(r => r.name === log.reason);
    if (existing) {
      existing.value += log.quantity;
    } else {
      acc.push({ name: log.reason, value: log.quantity });
    }
    return acc;
  }, []);

  // Calculate revenue by day
  const revenueByDay = eachDayOfInterval({ start: startDate, end: endDate }).map(day => {
    const dayInvoices = filteredInvoices.filter(i => 
      format(new Date(i.created_at!), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
    );
    return {
      date: format(day, 'MMM dd'),
      revenue: dayInvoices.reduce((sum, i) => sum + Number(i.total_amount || 0), 0),
    };
  });

  // Room type distribution
  const roomTypeData = rooms.reduce((acc: any[], room) => {
    const existing = acc.find(r => r.name === room.room_type);
    if (existing) {
      existing.value++;
    } else {
      acc.push({ name: room.room_type, value: 1 });
    }
    return acc;
  }, []);

  // Booking status distribution
  const bookingStatusData = filteredBookings.reduce((acc: any[], booking) => {
    const existing = acc.find(b => b.name === booking.status);
    if (existing) {
      existing.value++;
    } else {
      acc.push({ name: booking.status, value: 1 });
    }
    return acc;
  }, []);

  // Occupancy by day
  const occupancyByDay = eachDayOfInterval({ start: startDate, end: endDate }).map(day => {
    const occupiedRooms = bookings.filter(b => {
      const checkIn = new Date(b.check_in_date);
      const checkOut = new Date(b.check_out_date);
      return isWithinInterval(day, { start: checkIn, end: checkOut }) && 
             ['checked_in', 'confirmed'].includes(b.status);
    }).length;
    return {
      date: format(day, 'MMM dd'),
      occupancy: rooms.length > 0 ? Math.round((occupiedRooms / rooms.length) * 100) : 0,
    };
  });

  const totalRevenue = filteredInvoices.reduce((sum, i) => sum + Number(i.total_amount || 0), 0);
  const avgDailyRevenue = totalRevenue / parseInt(dateRange);
  const totalBookings = filteredBookings.length;

  // VAT Calculations for Rwanda (18% standard)
  const totalVATCollected = filteredInvoices.reduce((sum, i) => sum + Number(i.tax_amount || 0), 0);
  const totalTaxableSales = filteredInvoices.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
  const invoiceMap = useMemo(
    () => Object.fromEntries(invoices.map((invoice) => [invoice.id, invoice])),
    [invoices]
  );
  const invoicePaymentsMap = useMemo(
    () => buildInvoicePaymentsMap(payments),
    [payments]
  );
  const paymentSummaryCards = [
    { label: "Cash", value: getMethodTotal(filteredPayments, ["cash"]), icon: Banknote, className: "text-emerald-600" },
    { label: "Mobile Money", value: getMethodTotal(filteredPayments, ["momo"]), icon: Smartphone, className: "text-rose-500" },
    { label: "Card", value: getMethodTotal(filteredPayments, ["card"]), icon: CreditCard, className: "text-blue-600" },
    { label: "Bank Transfer", value: getMethodTotal(filteredPayments, ["bank_transfer"]), icon: Building2, className: "text-amber-600" },
  ];
  
  // VAT by day
  const vatByDay = eachDayOfInterval({ start: startDate, end: endDate }).map(day => {
    const dayInvoices = filteredInvoices.filter(i => 
      format(new Date(i.created_at!), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
    );
    return {
      date: format(day, 'MMM dd'),
      taxable: dayInvoices.reduce((sum, i) => sum + Number(i.subtotal || 0), 0),
      vat: dayInvoices.reduce((sum, i) => sum + Number(i.tax_amount || 0), 0),
    };
  });

  const generatePDF = (reportType: string) => {
    const doc = new jsPDF();
    const title = `${businessName} ${reportType} Report`;
    
    doc.setFontSize(20);
    doc.text(title, 20, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${format(new Date(), 'PPP')}`, 20, 30);
    doc.text(`Period: Last ${dateRange} days`, 20, 36);

    if (reportType === 'Revenue') {
      autoTable(doc, {
        startY: 45,
        head: [['Date', 'Revenue']],
        body: revenueByDay.map(d => [d.date, formatCurrency(d.revenue)]),
      });
      doc.text(`Total Revenue: ${formatCurrency(totalRevenue)}`, 20, (doc as any).lastAutoTable.finalY + 10);
    } else if (reportType === 'Bookings') {
      autoTable(doc, {
        startY: 45,
        head: [['Reference', 'Guest', 'Check-in', 'Check-out', 'Status', 'Amount']],
        body: filteredBookings.map(b => [
          b.booking_reference,
          b.guest ? `${b.guest.first_name} ${b.guest.last_name}` : '-',
          format(new Date(b.check_in_date), 'MMM dd, yyyy'),
          format(new Date(b.check_out_date), 'MMM dd, yyyy'),
          b.status,
          formatCurrency(b.total_amount || 0),
        ]),
      });
    } else if (reportType === 'Occupancy') {
      autoTable(doc, {
        startY: 45,
        head: [['Date', 'Occupancy Rate']],
        body: occupancyByDay.map(d => [d.date, `${d.occupancy}%`]),
      });
    } else if (reportType === 'VAT') {
      autoTable(doc, {
        startY: 45,
        head: [['Date', 'Taxable Sales', 'VAT Collected']],
        body: vatByDay.map(d => [d.date, formatCurrency(d.taxable), formatCurrency(d.vat)]),
      });
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.text(`Total Taxable Sales: ${formatCurrency(totalTaxableSales)}`, 20, finalY);
      doc.text(`Total VAT Collected: ${formatCurrency(totalVATCollected)}`, 20, finalY + 8);
    } else if (reportType === 'Payments') {
      autoTable(doc, {
        startY: 45,
        head: [['Date', 'Invoice', 'Method', 'Amount']],
        body: filteredPayments.map((payment) => [
          format(new Date(payment.created_at), 'MMM dd, yyyy HH:mm'),
          invoiceMap[payment.invoice_id || '']?.invoice_number || payment.receipt_no || '-',
          formatHotelPaymentMethod(payment.payment_method),
          formatCurrency(Number(payment.amount || 0)),
        ]),
      });
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.text(`Filtered payment total: ${formatCurrency(filteredPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0))}`, 20, finalY);
    }

    doc.save(`${businessName.toLowerCase().replace(/\s+/g, '-')}-${reportType.toLowerCase()}-report.pdf`);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Reports & Analytics</h1>
            <p className="text-muted-foreground">View hotel performance metrics</p>
          </div>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <DollarSign className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(totalRevenue)}</p>
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Calendar className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{totalBookings}</p>
                  <p className="text-sm text-muted-foreground">Total Bookings</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-500/10 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(avgDailyRevenue)}</p>
                  <p className="text-sm text-muted-foreground">Avg Daily Revenue</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-500/10 rounded-lg">
                  <Users className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{guests.length}</p>
                  <p className="text-sm text-muted-foreground">Total Guests</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="revenue">
          <ScrollArea className="w-full">
            <TabsList className="w-max min-w-full justify-start">
              <TabsTrigger value="revenue">Revenue</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="occupancy">Occupancy</TabsTrigger>
              <TabsTrigger value="vat">VAT Report</TabsTrigger>
              <TabsTrigger value="food-cost">Food & Stock</TabsTrigger>
            </TabsList>
          </ScrollArea>

          <TabsContent value="revenue" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Revenue Trend</CardTitle>
                <Button variant="outline" size="sm" onClick={() => generatePDF('Revenue')}>
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueByDay}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {paymentSummaryCards.map((card) => (
                <Card key={card.label}>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <div className="rounded-lg bg-muted/40 p-3">
                        <card.icon className={`h-6 w-6 ${card.className}`} />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{formatCurrency(card.value)}</p>
                        <p className="text-sm text-muted-foreground">{card.label}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Payment Report</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Filter how much was received by method using posted payment records. Split settlements are counted by the real posted methods.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Filter payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Methods</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="momo">Mobile Money</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => generatePDF('Payments')}>
                    <Download className="mr-2 h-4 w-4" />
                    Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <p className="text-sm text-muted-foreground">Filtered Total</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(filteredPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0))}
                  </p>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                          No payments found for this filter and date range.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPayments.map((payment) => {
                        const invoice = invoiceMap[payment.invoice_id || ""];
                        return (
                          <TableRow key={payment.id}>
                            <TableCell>{format(new Date(payment.created_at), 'MMM dd, yyyy HH:mm')}</TableCell>
                            <TableCell className="font-medium">
                              {invoice?.invoice_number || payment.receipt_no || '-'}
                            </TableCell>
                            <TableCell>{invoice?.customer_name || 'Walk-in'}</TableCell>
                            <TableCell>{formatHotelPaymentMethod(payment.payment_method)}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatCurrency(Number(payment.amount || 0))}
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

          <TabsContent value="occupancy" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Occupancy Rate</CardTitle>
                <Button variant="outline" size="sm" onClick={() => generatePDF('Occupancy')}>
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={occupancyByDay}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Line type="monotone" dataKey="occupancy" stroke="hsl(var(--primary))" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="vat" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800/50">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-amber-500/10 rounded-lg">
                      <Receipt className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{formatCurrency(totalVATCollected)}</p>
                      <p className="text-sm text-muted-foreground">Total VAT Collected</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 border-emerald-200 dark:border-emerald-800/50">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-500/10 rounded-lg">
                      <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{formatCurrency(totalTaxableSales)}</p>
                      <p className="text-sm text-muted-foreground">Taxable Sales</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800/50">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-lg">
                      <div className="text-center">
                        <p className="text-lg font-bold text-blue-600 dark:text-blue-400">18%</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">Standard</p>
                      <p className="text-sm text-muted-foreground">VAT Rate</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-amber-600" />
                  VAT Trend (Last {dateRange} Days)
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => generatePDF('VAT')}>
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={vatByDay}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Bar dataKey="taxable" name="Taxable Sales" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="vat" name="VAT Collected" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>VAT Details by Invoice</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">VAT</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.slice(0, 20).map((invoice) => {
                      const paymentSummary = getInvoicePaymentSummary(invoice.id, invoicePaymentsMap);

                      return (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-medium">{invoice.invoice_number || '-'}</TableCell>
                          <TableCell>{format(new Date(invoice.created_at!), 'MMM dd, yyyy')}</TableCell>
                          <TableCell>{invoice.customer_name || 'Walk-in'}</TableCell>
                          <TableCell>
                            {paymentSummary.primaryMethod || invoice.payment_method
                              ? (
                                <div className="space-y-1">
                                  <div>{formatHotelPaymentMethod(paymentSummary.primaryMethod || invoice.payment_method)}</div>
                                  {paymentSummary.entries.length > 1 && (
                                    <div className="text-xs text-muted-foreground">
                                      {paymentSummary.entries
                                        .map((entry) => `${entry.label}: ${formatCurrency(entry.amount)}`)
                                        .join(" | ")}
                                    </div>
                                  )}
                                </div>
                              )
                              : <span className="text-muted-foreground">Not settled</span>}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(invoice.subtotal || 0))}</TableCell>
                          <TableCell className="text-right font-semibold text-amber-600">{formatCurrency(Number(invoice.tax_amount || 0))}</TableCell>
                          <TableCell className="text-right font-bold">{formatCurrency(Number(invoice.total_amount || 0))}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {filteredInvoices.length > 20 && (
                  <div className="text-center mt-4 text-sm text-muted-foreground">
                    Showing 20 of {filteredInvoices.length} invoices. Export PDF for complete data.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          
          <TabsContent value="food-cost" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Utensils className="h-5 w-5 text-primary" />
                    Profit Margin by Dish
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={foodCostData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                        <XAxis type="number" unit="%" className="text-xs" />
                        <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                          formatter={(value: number) => [`${value.toFixed(1)}%`, 'Profit Margin']}
                        />
                        <Bar dataKey="margin" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ThermometerSnowflake className="h-5 w-5 text-destructive" />
                    Wastage Analysis (Quantity)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={wastageByReason}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {wastageByReason.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Menu Item Financial Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dish Name</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Est. Cost</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-center">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {foodCostData.map((item) => (
                      <TableRow key={item.name}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.price)}</TableCell>
                        <TableCell className="text-right text-red-500">{formatCurrency(item.cost)}</TableCell>
                        <TableCell className="text-right text-green-600">{formatCurrency(item.price - item.cost)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={item.margin > 40 ? 'default' : 'secondary'}>
                            {item.margin.toFixed(0)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}