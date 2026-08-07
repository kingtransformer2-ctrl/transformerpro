import { useState, useMemo } from 'react';
import { cn } from "@/lib/utils";
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { format, startOfDay, endOfDay, differenceInHours, startOfMonth, differenceInMinutes } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Calendar as CalendarIcon, User, Clock, Receipt, Eye, 
  TrendingUp, ShoppingCart, Loader2, ChevronRight, X, DollarSign,
  FileText, Timer, ChefHat, AlertTriangle, Activity
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSettingsContext } from '@/contexts/SettingsContext';

interface StationReportProps {
  station: 'kitchen' | 'bar';
  onClose?: () => void;
}

export function StationReport({ station, onClose }: StationReportProps) {
  const { formatCurrency } = useSettingsContext();
  const [startDate, setStartDate] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  // Fetch report data
  const { data: reportData, isLoading } = useQuery({
    queryKey: ['station-report', station, startDate, endDate],
    queryFn: async () => {
      const start = startOfDay(new Date(startDate)).toISOString();
      const end = endOfDay(new Date(endDate)).toISOString();

      // 1. Fetch orders with items for this station that reached ready/served/etc.
      const { data: orders, error: ordersError } = await apiClient
        .from('hotel_orders')
        .select(`
          *,
          waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name),
          items:hotel_order_items(*)
        `)
        .in('status', ['ready', 'served', 'billed', 'paid', 'settled', 'cancelled'])
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      // Filter orders to only those that have items for this station
      const stationOrders = (orders || []).filter(order => 
        order.items?.some((item: any) => item.station === station)
      );

      // 2. Fetch shifts for the same date to calculate hours
      const { data: shifts, error: shiftsError } = await apiClient
        .from('hotel_staff_shifts')
        .select('*, staff:hotel_staff(id, first_name, last_name)')
        .gte('opened_at', start)
        .lte('opened_at', end);

      if (shiftsError) throw shiftsError;

      // 3. Fetch logs for these orders to calculate prep times and staff accountability
      const { data: logs, error: logsError } = await apiClient
        .from('hotel_shift_logs')
        .select('*, staff:hotel_staff(id, first_name, last_name)')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: true });

      if (logsError) throw logsError;

      return { orders: stationOrders, shifts: shifts || [], logs: logs || [] };
    },
    enabled: true,
  });

  // Calculate stats
  const stats = useMemo(() => {
    if (!reportData?.orders) return { 
      totalAmount: 0, orderCount: 0, cancelledCount: 0,
      waiterStats: [], kitchenStaffStats: [], 
      avgPrepTime: 0, prepTimes: [], popularItems: [], peakHours: [],
      bottlenecks: []
    };

    const orders = reportData.orders;
    const logs = reportData.logs || [];
    let totalAmount = 0;
    let cancelledCount = 0;
    const prepTimes: number[] = [];
    const itemMap = new Map<string, { name: string, count: number, revenue: number, totalPrepTime: number, prepCount: number }>();
    const hourMap = new Map<number, number>();

    // Map to track order status transitions
    const orderTransitions = new Map<string, { preparingAt?: string, readyAt?: string, staffId?: string, staffName?: string }>();

    logs.forEach(log => {
      if (!log.reference_id) return;
      
      const desc = log.description?.toLowerCase() || '';
      const current = orderTransitions.get(log.reference_id) || {};
      
      // Check if log is for this station or global
      const isStationLog = desc.includes(`${station}:`) || (!desc.includes('kitchen:') && !desc.includes('bar:'));
      
      if (isStationLog) {
        if (desc.includes('status changed to preparing')) {
          current.preparingAt = log.created_at;
        } else if (desc.includes('status changed to ready') || desc.includes('status changed to served')) {
          if (!current.readyAt || desc.includes('status changed to ready')) {
            current.readyAt = log.created_at;
            current.staffId = log.staff_id;
            current.staffName = log.staff ? `${log.staff.first_name} ${log.staff.last_name}` : 'Unknown';
          }
        }
      }
      
      orderTransitions.set(log.reference_id, current);
    });

    // Waiter performance
    const waiterMap = new Map();
    // Kitchen staff performance
    const kitchenStaffMap = new Map();
    
    orders.forEach(order => {
      if (order.status === 'cancelled') {
        cancelledCount++;
      }

      const stationItems = (order.items || []).filter((item: any) => item.station === station);
      const stationItemsAmount = stationItems.reduce((sum: number, item: any) => sum + Number(item.total_price), 0);
      
      if (order.status !== 'cancelled') {
        totalAmount += stationItemsAmount;
      }
      
      // Get transition for this order
      const transition = orderTransitions.get(order.id);
      let orderPrepTime = 0;
      if (transition?.preparingAt && transition?.readyAt) {
        orderPrepTime = differenceInMinutes(new Date(transition.readyAt), new Date(transition.preparingAt));
      }

      // Popular items & Bottlenecks tracking
      stationItems.forEach((item: any) => {
        const existing = itemMap.get(item.name) || { name: item.name, count: 0, revenue: 0, totalPrepTime: 0, prepCount: 0 };
        existing.count += Number(item.quantity);
        existing.revenue += Number(item.total_price);
        
        if (orderPrepTime > 0 && orderPrepTime < 120) {
          existing.totalPrepTime += orderPrepTime;
          existing.prepCount += 1;
        }
        
        itemMap.set(item.name, existing);
      });

      // Peak hours tracking
      const hour = new Date(order.created_at).getHours();
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);

      // Waiter tracking
      const waiterId = order.waiter_id;
      if (waiterId && order.status !== 'cancelled') {
        const existing = waiterMap.get(waiterId) || { 
          name: order.waiter ? `${order.waiter.first_name} ${order.waiter.last_name}` : 'Unknown Waiter',
          totalAmount: 0,
          orderCount: 0,
          workingHours: 0
        };
        existing.totalAmount += stationItemsAmount;
        existing.orderCount += 1;
        waiterMap.set(waiterId, existing);
      }

      // Kitchen/Bar Staff tracking from transitions
      if (transition?.staffId && order.status !== 'cancelled') {
        const existing = kitchenStaffMap.get(transition.staffId) || {
          name: transition.staffName,
          orderCount: 0,
          totalPrepTime: 0,
          completedOrders: 0
        };
        
        existing.orderCount += 1;
        
        if (orderPrepTime > 0 && orderPrepTime < 120) {
          existing.totalPrepTime += orderPrepTime;
          existing.completedOrders += 1;
          prepTimes.push(orderPrepTime);
        }
        
        kitchenStaffMap.set(transition.staffId, existing);
      }
    });

    // Add working hours from shifts
    reportData.shifts.forEach(shift => {
      const waiterId = shift.staff_id;
      if (waiterMap.has(waiterId)) {
        const stats = waiterMap.get(waiterId);
        const hours = shift.closed_at 
          ? differenceInHours(new Date(shift.closed_at), new Date(shift.opened_at))
          : differenceInHours(new Date(), new Date(shift.opened_at));
        stats.workingHours = (stats.workingHours || 0) + Math.max(0, hours);
      }
    });

    const avgPrepTime = prepTimes.length > 0 
      ? Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length) 
      : 0;

    const itemsArray = Array.from(itemMap.values());

    // Stress Calculation: Peak Hour Intensity vs Avg and Cancellation impact
    const avgOrdersPerHour = orders.length / Math.max(1, hourMap.size);
    const peakHourCount = hourMap.size > 0 ? Math.max(...Array.from(hourMap.values())) : 0;
    const intensityRatio = avgOrdersPerHour > 0 ? peakHourCount / avgOrdersPerHour : 0;
    const cancellationRate = orders.length > 0 ? (cancelledCount / orders.length) : 0;
    
    // Score components: Intensity (up to 7) + Cancellations (up to 3)
    const stressScore = Math.min(10, (intensityRatio * 2) + (cancellationRate * 30));

    return {
      totalAmount,
      orderCount: orders.length,
      cancelledCount,
      avgPrepTime,
      prepTimes,
      stressScore,
      popularItems: [...itemsArray].sort((a, b) => b.count - a.count).slice(0, 5),
      bottlenecks: [...itemsArray]
        .filter(i => i.prepCount > 0)
        .map(i => ({ ...i, avgPrepTime: Math.round(i.totalPrepTime / i.prepCount) }))
        .sort((a, b) => b.avgPrepTime - a.avgPrepTime)
        .slice(0, 5),
      peakHours: Array.from(hourMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hour, count]) => ({
        hour: `${hour}:00`,
        count
      })),
      waiterStats: Array.from(waiterMap.values()),
      kitchenStaffStats: Array.from(kitchenStaffMap.values()).map((s: any) => ({
        ...s,
        avgPrepTime: s.completedOrders > 0 ? Math.round(s.totalPrepTime / s.completedOrders) : 0
      }))
    };
  }, [reportData, station]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 animate-in fade-in duration-300">
      <div className="p-4 md:p-6 bg-white border-b shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
                <ChevronRight className="h-5 w-5 rotate-180" />
              </Button>
            )}
            <div>
              <h2 className="text-xl md:text-2xl font-black flex items-center gap-2 uppercase tracking-tighter">
                <Receipt className="h-6 w-6 text-primary" />
                {station} Operational Report
              </h2>
              <p className="font-bold text-slate-400 uppercase text-[10px] tracking-widest mt-0.5">
                Full performance record and service history
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                className="pl-10 h-10 w-40 rounded-xl border-slate-200 font-bold text-sm"
              />
            </div>
            <span className="text-slate-400 font-bold text-xs uppercase">to</span>
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                className="pl-10 h-10 w-40 rounded-xl border-slate-200 font-bold text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-y-auto custom-scrollbar min-h-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400 min-h-[300px]">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <span className="font-black text-xs uppercase tracking-widest">Compiling Analytics...</span>
            </div>
          ) : (
            <div className="space-y-8 pb-10">
              {/* Three Pillars Navigation / Header */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Pillar 1: Service Efficiency */}
                <Card className="bg-white border-slate-100 shadow-sm rounded-3xl overflow-hidden border-l-4 border-l-primary">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
                        <Timer className="h-5 w-5 text-primary" />
                      </div>
                      <Badge variant="secondary" className="bg-primary/5 text-primary border-none font-black text-[9px] uppercase tracking-widest">Pillar 1</Badge>
                    </div>
                    <h3 className="font-black text-slate-900 uppercase tracking-tighter text-lg">Service Efficiency</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Speed & Quality Metrics</p>
                    
                    <div className="space-y-4">
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Avg Prep Time</p>
                          <p className="text-2xl font-black text-slate-900 tabular-nums">{stats.avgPrepTime} <span className="text-xs text-slate-400">min</span></p>
                        </div>
                        <Badge className={cn(
                          "font-black text-[9px] mb-1",
                          stats.avgPrepTime <= 15 ? "bg-emerald-500" : stats.avgPrepTime <= 30 ? "bg-amber-500" : "bg-rose-500"
                        )}>
                          {stats.avgPrepTime <= 15 ? 'EXCELLENT' : stats.avgPrepTime <= 30 ? 'OPTIMAL' : 'DELAYED'}
                        </Badge>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full transition-all duration-500", stats.avgPrepTime <= 15 ? "bg-emerald-500" : stats.avgPrepTime <= 30 ? "bg-amber-500" : "bg-rose-500")}
                          style={{ width: `${Math.min(100, (stats.avgPrepTime / 45) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Pillar 2: Staff Performance */}
                <Card className="bg-white border-slate-100 shadow-sm rounded-3xl overflow-hidden border-l-4 border-l-indigo-500">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="h-10 w-10 rounded-2xl bg-indigo-50 flex items-center justify-center">
                        <User className="h-5 w-5 text-indigo-500" />
                      </div>
                      <Badge variant="secondary" className="bg-indigo-50 text-indigo-500 border-none font-black text-[9px] uppercase tracking-widest">Pillar 2</Badge>
                    </div>
                    <h3 className="font-black text-slate-900 uppercase tracking-tighter text-lg">Staff Performance</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Accountability & Output</p>
                    
                    <div className="space-y-4">
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Success Rate</p>
                          <p className="text-2xl font-black text-slate-900 tabular-nums">
                            {stats.orderCount > 0 ? Math.round(((stats.orderCount - stats.cancelledCount) / stats.orderCount) * 100) : 100}%
                          </p>
                        </div>
                        <Badge className="bg-indigo-500 font-black text-[9px] mb-1">
                          {stats.orderCount} TOTAL
                        </Badge>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-indigo-500 transition-all duration-500"
                          style={{ width: `${stats.orderCount > 0 ? ((stats.orderCount - stats.cancelledCount) / stats.orderCount) * 100 : 100}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Pillar 3: Operational Health */}
                <Card className="bg-white border-slate-100 shadow-sm rounded-3xl overflow-hidden border-l-4 border-l-amber-500">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="h-10 w-10 rounded-2xl bg-amber-50 flex items-center justify-center">
                        <Activity className="h-5 w-5 text-amber-500" />
                      </div>
                      <Badge variant="secondary" className="bg-amber-50 text-amber-500 border-none font-black text-[9px] uppercase tracking-widest">Pillar 3</Badge>
                    </div>
                    <h3 className="font-black text-slate-900 uppercase tracking-tighter text-lg">Operational Health</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Stress & Capacity</p>
                    
                    <div className="space-y-4">
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stress Score</p>
                          <p className="text-2xl font-black text-slate-900 tabular-nums">
                            {stats.stressScore.toFixed(1)} <span className="text-xs text-slate-400">/ 10</span>
                          </p>
                        </div>
                        <Badge className={cn(
                          "font-black text-[9px] mb-1",
                          stats.stressScore <= 4 ? "bg-emerald-500" : stats.stressScore <= 7 ? "bg-amber-500" : "bg-rose-500"
                        )}>
                          {stats.stressScore <= 4 ? 'STABLE' : stats.stressScore <= 7 ? 'BUSY' : 'CRITICAL'}
                        </Badge>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full transition-all duration-500", stats.stressScore <= 4 ? "bg-emerald-500" : stats.stressScore <= 7 ? "bg-amber-500" : "bg-rose-500")}
                          style={{ width: `${Math.min(100, (stats.stressScore / 10) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Top Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Card className="bg-primary text-white border-none shadow-xl shadow-primary/20 rounded-3xl overflow-hidden relative">
                  <CardContent className="p-4 md:p-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">{station} REVENUE</span>
                      <TrendingUp className="h-5 w-5 opacity-50" />
                    </div>
                    <div className="text-2xl md:text-3xl font-black tracking-tighter tabular-nums">
                      {formatCurrency(stats.totalAmount)}
                    </div>
                    <div className="absolute -bottom-4 -right-4 opacity-10">
                      <DollarSign className="h-20 w-20 md:h-24 md:w-24" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white border-slate-100 shadow-sm rounded-3xl overflow-hidden">
                  <CardContent className="p-4 md:p-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Total {station} Orders</span>
                      {station === 'kitchen' ? (
                        <ShoppingCart className="h-5 w-5 text-indigo-500 opacity-50" />
                      ) : (
                        <Wine className="h-5 w-5 text-purple-500 opacity-50" />
                      )}
                    </div>
                    <div className="text-2xl md:text-3xl font-black text-slate-900 tracking-tighter tabular-nums">
                      {stats.orderCount}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {stats.cancelledCount > 0 && (
                        <Badge variant="secondary" className="bg-rose-50 text-rose-600 text-[8px] font-black uppercase py-0 px-1.5">
                          {stats.cancelledCount} CANCELLED
                        </Badge>
                      )}
                      <Badge variant="secondary" className="bg-emerald-50 text-emerald-600 text-[8px] font-black uppercase py-0 px-1.5">
                        {stats.orderCount > 0 ? Math.round(((stats.orderCount - stats.cancelledCount) / stats.orderCount) * 100) : 100}% SUCCESS RATE
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white border-slate-100 shadow-sm rounded-3xl overflow-hidden sm:col-span-2 lg:col-span-1">
                  <CardContent className="p-4 md:p-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Avg Prep Time</span>
                      <Timer className="h-5 w-5 text-amber-500 opacity-50" />
                    </div>
                    <div className="text-2xl md:text-3xl font-black text-slate-900 tracking-tighter tabular-nums">
                      {stats.avgPrepTime} <span className="text-xs font-bold text-slate-400 uppercase">Min</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Kitchen Staff Performance Table */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-sm uppercase tracking-widest text-slate-900 flex items-center gap-2">
                      {station === 'kitchen' ? (
                        <ChefHat className="h-4 w-4 text-primary" />
                      ) : (
                        <Wine className="h-4 w-4 text-purple-500" />
                      )}
                      {station === 'kitchen' ? 'Chef' : 'Barman'} Efficiency
                    </h3>
                  </div>
                  <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-slate-50/50">
                          <TableRow className="hover:bg-transparent border-slate-100">
                            <TableHead className="text-[10px] font-black uppercase tracking-widest py-4">Name</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-center">Ready</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">Avg. Speed</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stats.kitchenStaffStats.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3} className="h-32 text-center text-slate-400">
                                <div className="flex flex-col items-center justify-center gap-2">
                                  <Activity className="h-6 w-6 opacity-20" />
                                  <p className="font-black uppercase text-[10px] tracking-widest">No preparation logs</p>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : (
                            stats.kitchenStaffStats.map((staff: any, idx) => (
                              <TableRow key={idx} className="border-slate-50 hover:bg-slate-50/50 transition-colors">
                                <TableCell className="py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                      {station === 'kitchen' ? (
                                        <ChefHat className="h-4 w-4 text-primary" />
                                      ) : (
                                        <Wine className="h-4 w-4 text-purple-500" />
                                      )}
                                    </div>
                                    <span className="font-bold text-slate-900 text-xs truncate max-w-[100px]">{staff.name}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-center font-black text-slate-700">{staff.orderCount}</TableCell>
                                <TableCell className="text-right">
                                  <Badge variant="secondary" className={cn(
                                    "font-black text-[10px] px-2 py-1",
                                    staff.avgPrepTime <= 15 ? "bg-emerald-50 text-emerald-600" :
                                    staff.avgPrepTime <= 30 ? "bg-amber-50 text-amber-600" :
                                    "bg-rose-50 text-rose-600"
                                  )}>
                                    {staff.avgPrepTime} MINS
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-black text-sm uppercase tracking-widest text-slate-900 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    Top Selling Items
                  </h3>
                  <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm p-4">
                    <div className="space-y-3">
                      {stats.popularItems.length === 0 ? (
                        <div className="h-32 flex flex-col items-center justify-center text-slate-400 gap-2">
                          <ShoppingCart className="h-6 w-6 opacity-20" />
                          <p className="font-black uppercase text-[10px] tracking-widest">No sales data</p>
                        </div>
                      ) : (
                        stats.popularItems.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 rounded-2xl bg-slate-50/50 hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center font-black text-xs text-slate-400">
                                {idx + 1}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900 text-xs">{item.name}</p>
                                <p className="text-[10px] font-black text-slate-400 uppercase">{item.count} units sold</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-primary text-xs">{formatCurrency(item.revenue)}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-black text-sm uppercase tracking-widest text-slate-900 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-500" />
                    Preparation Bottlenecks
                  </h3>
                  <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm p-4">
                    <div className="space-y-3">
                      {stats.bottlenecks.length === 0 ? (
                        <div className="h-32 flex flex-col items-center justify-center text-slate-400 gap-2">
                          <Timer className="h-6 w-6 opacity-20" />
                          <p className="font-black uppercase text-[10px] tracking-widest">No timing data</p>
                        </div>
                      ) : (
                        stats.bottlenecks.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 rounded-2xl bg-slate-50/50 hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center font-black text-xs text-rose-500">
                                <Timer className="h-3.5 w-3.5" />
                              </div>
                              <div>
                                <p className="font-bold text-slate-900 text-xs">{item.name}</p>
                                <p className="text-[10px] font-black text-slate-400 uppercase">Avg. {item.avgPrepTime} mins</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <Badge variant="secondary" className={cn(
                                "font-black text-[9px] px-1.5 py-0",
                                item.avgPrepTime > 40 ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"
                              )}>
                                SLOW
                              </Badge>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Peak Hours & Waiter Performance */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 space-y-4">
                  <h3 className="font-black text-sm uppercase tracking-widest text-slate-900 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-500" />
                    Peak Service Times
                  </h3>
                  <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex flex-col justify-center gap-4">
                    {stats.peakHours.length === 0 ? (
                      <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-2">
                        <Timer className="h-8 w-8 opacity-20" />
                        <p className="font-black uppercase text-[10px] tracking-widest text-center">Waiting for peak data...</p>
                      </div>
                    ) : (
                      stats.peakHours.map((peak, idx) => (
                        <div key={idx} className="flex items-center gap-4">
                          <div className={cn(
                            "h-10 w-10 rounded-2xl flex items-center justify-center shrink-0",
                            idx === 0 ? "bg-rose-500 text-white shadow-lg shadow-rose-200" : 
                            idx === 1 ? "bg-amber-500 text-white shadow-lg shadow-amber-100" :
                            "bg-slate-100 text-slate-500"
                          )}>
                            <Clock className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-black text-slate-900 text-sm">{peak.hour}</p>
                            <p className="text-[10px] font-black text-slate-400 uppercase">{peak.count} orders received</p>
                          </div>
                          {idx === 0 && (
                            <Badge className="ml-auto bg-rose-50 text-rose-600 border-none font-black text-[10px]">PEAK</Badge>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-sm uppercase tracking-widest text-slate-900 flex items-center gap-2">
                      <User className="h-4 w-4 text-indigo-500" />
                      Waiter Sales Performance
                    </h3>
                  </div>
                  <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-slate-50/50">
                          <TableRow className="hover:bg-transparent border-slate-100">
                            <TableHead className="text-[10px] font-black uppercase tracking-widest py-4">Waiter Name</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-center">Orders</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-center hidden sm:table-cell">Work Hours</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-right">Total Vol.</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stats.waiterStats.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="h-32 text-center text-slate-400">
                                <div className="flex flex-col items-center justify-center gap-2">
                                  <FileText className="h-8 w-8 opacity-20" />
                                  <p className="font-black uppercase text-[10px] tracking-widest">No served orders</p>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : (
                            stats.waiterStats.map((waiter, idx) => (
                              <TableRow key={idx} className="border-slate-50 hover:bg-slate-50/50 transition-colors">
                                <TableCell className="py-4">
                                  <div className="flex items-center gap-2 md:gap-3">
                                    <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                      <User className="h-4 w-4 text-slate-400" />
                                    </div>
                                    <span className="font-bold text-slate-900 text-xs md:text-sm truncate max-w-[120px]">{waiter.name}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-center font-black text-slate-700">{waiter.orderCount}</TableCell>
                                <TableCell className="text-center hidden sm:table-cell">
                                  <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-black text-[10px]">
                                    {waiter.workingHours || 0} HRS
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-black text-primary text-xs md:text-sm">{formatCurrency(waiter.totalAmount)}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </div>

              {/* Orders List */}
              <div className="space-y-4">
                <h3 className="font-black text-sm uppercase tracking-widest text-slate-900">Service Logs</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {reportData?.orders.map((order: any) => (
                    <div 
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      className={cn(
                        "bg-white border p-3 md:p-4 rounded-2xl flex items-center justify-between group cursor-pointer transition-all",
                        selectedOrder?.id === order.id ? "border-primary shadow-md ring-1 ring-primary/20" : "border-slate-100 hover:border-primary/30 hover:shadow-md"
                      )}
                    >
                      <div className="flex items-center gap-3 md:gap-4 min-w-0">
                        <div className="h-9 w-9 md:h-10 md:w-10 rounded-xl bg-slate-50 flex flex-col items-center justify-center border border-slate-100 shrink-0">
                          <span className="text-[7px] md:text-[8px] font-black text-slate-400 uppercase leading-none">Node</span>
                          <span className="text-[10px] md:text-xs font-black text-slate-900">#{order.order_number.slice(-4)}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-xs md:text-sm text-slate-900 uppercase truncate">
                            {order.room?.room_number ? `Room ${order.room.room_number}` : `Table ${order.table_number || 'WI'}`}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] md:text-[10px] font-bold text-slate-400 flex items-center gap-1 shrink-0">
                              <Clock className="h-2.5 w-2.5" /> {format(new Date(order.created_at), 'HH:mm')}
                            </span>
                            <Badge variant="outline" className="text-[7px] md:text-[8px] font-black px-1.5 py-0 bg-emerald-50 text-emerald-600 border-emerald-100 shrink-0">
                              {order.status.toUpperCase()}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-2 md:gap-3 shrink-0">
                        <span className="font-black text-slate-900 text-xs md:text-sm">{formatCurrency(order.total_amount)}</span>
                        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Side Details Panel - Modern Sliding Pane */}
        {selectedOrder && (
          <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-300">
            <div 
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" 
              onClick={() => setSelectedOrder(null)}
            />
            <div className="w-full max-w-[95%] md:w-[500px] h-full bg-white relative z-10 shadow-[-20px_0_50px_rgba(0,0,0,0.1)] flex flex-col animate-in slide-in-from-right duration-500">
              <div className="p-6 md:p-8 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-20">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-black uppercase tracking-widest">Order Node</span>
                    <span className="text-sm font-black text-primary">#{selectedOrder.order_number.slice(-6)}</span>
                  </div>
                  <h4 className="text-2xl font-black uppercase tracking-tighter text-slate-900 italic">Financial Audit Detail</h4>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setSelectedOrder(null)} 
                  className="h-12 w-12 rounded-full hover:bg-slate-100 hover:rotate-90 transition-all duration-300"
                >
                  <X className="h-6 w-6 text-slate-400" />
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-6 md:p-8 space-y-10">
                  {/* Order Summary Receipt */}
                  <div className="relative p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:scale-110 transition-transform duration-700">
                      <Receipt className="h-32 w-32" />
                    </div>
                    
                    <div className="relative z-10 space-y-6">
                      <div className="flex flex-col items-center text-center pb-6 border-b border-slate-200 border-dashed">
                        <span className="text-[10px] font-black text-primary uppercase tracking-[0.3em] mb-2">{station} Contribution</span>
                        {(() => {
                          const stationContribution = (selectedOrder.items || [])
                            .filter((item: any) => item.station === station)
                            .reduce((sum: number, item: any) => sum + Number(item.total_price), 0);
                          
                          return (
                            <>
                              <span className="text-5xl font-black text-slate-900 tracking-tighter tabular-nums mb-2">
                                {formatCurrency(stationContribution)}
                              </span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="bg-white/50 text-[10px] font-black px-3 py-1">
                                  {Math.round((stationContribution / selectedOrder.total_amount) * 100)}% OF TOTAL BILL
                                </Badge>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div className="grid grid-cols-2 gap-6 pt-2">
                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Deployment Unit</p>
                          <p className="text-lg font-black text-slate-800">
                            {selectedOrder.room?.room_number ? `Room ${selectedOrder.room.room_number}` : `Table ${selectedOrder.table_number || 'Walk-In'}`}
                          </p>
                        </div>
                        <div className="space-y-1 text-right">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Service Handler</p>
                          <p className="text-lg font-black text-slate-800 truncate">{selectedOrder.waiter?.first_name} {selectedOrder.waiter?.last_name}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Closure Timestamp</p>
                          <p className="text-sm font-bold text-slate-600 flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-primary" />
                            {format(new Date(selectedOrder.created_at), 'MMM dd, HH:mm:ss')}
                          </p>
                        </div>
                        <div className="space-y-1 text-right">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Billing Total</p>
                          <p className="text-sm font-bold text-slate-600">{formatCurrency(selectedOrder.total_amount)}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Station Items Breakdown */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
                      <h3 className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-3">
                        <div className="h-4 w-1 bg-primary rounded-full" />
                        Itemized Performance
                      </h3>
                      <Badge className="bg-slate-900 text-white font-black text-[10px]">
                        {(selectedOrder.items || []).filter((item: any) => item.station === station).length} SKU(S)
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      {(selectedOrder.items || [])
                        .filter((item: any) => item.station === station)
                        .map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-5 bg-white border border-slate-100 rounded-3xl hover:border-primary/20 hover:shadow-lg transition-all duration-300 group">
                            <div className="flex items-center gap-4">
                              <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center font-black text-slate-400 group-hover:bg-primary/5 group-hover:text-primary transition-colors">
                                {item.quantity}×
                              </div>
                              <div>
                                <p className={cn(
                                  "font-black text-sm uppercase tracking-tight",
                                  item.status === 'cancelled' ? "text-slate-400 line-through" : "text-slate-900"
                                )}>
                                  {item.name}
                                  {item.status === 'cancelled' && " (CANCELLED)"}
                                </p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                  Unit Price: {formatCurrency(item.unit_price)}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={cn(
                                "font-black text-base tabular-nums",
                                item.status === 'cancelled' ? "text-slate-400 line-through" : "text-slate-900"
                              )}>{formatCurrency(item.total_price)}</p>
                              <div className="flex items-center justify-end gap-1 mt-1">
                                <div className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  item.status === 'cancelled' ? "bg-red-500" : "bg-emerald-500"
                                )} />
                                <span className={cn(
                                  "text-[8px] font-black uppercase tracking-tighter",
                                  item.status === 'cancelled' ? "text-red-600" : "text-emerald-600"
                                )}>
                                  {item.status === 'cancelled' ? "Cancelled" : "Verified"}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Footnote */}
                  <div className="pt-10 text-center">
                    <p className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em] leading-relaxed">
                      This record is part of the {station} operational audit.<br />
                      Generated on {format(new Date(), 'yyyy-MM-dd HH:mm:ss')}
                    </p>
                  </div>
                </div>
              </ScrollArea>
              
              <div className="p-8 border-t border-slate-100 bg-white shrink-0">
                <Button 
                  onClick={() => setSelectedOrder(null)}
                  className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase tracking-widest shadow-xl transition-all active:scale-95"
                >
                  Close Audit View
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
