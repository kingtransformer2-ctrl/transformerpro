import { 
  Utensils, Users, ClipboardList, TrendingUp, ArrowRight, 
  Loader2, RefreshCw, DollarSign, Clock, ChefHat, CheckCircle2,
  XCircle, ShoppingBag, Wine, User, Calendar, Table, AlertTriangle,
  Zap, PieChart as PieChartIcon, Activity
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area } from 'recharts';
import { Layout } from '@/components/layout/Layout';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { isManagerLikeStaff } from '@/lib/hotelAccess';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigationAccess } from '@/hooks/useNavigationAccess';
import { useRestaurantDashboard } from '@/hooks/useRestaurantDashboard';
import { useCurrentShiftSummary } from '@/hooks/useHotelShifts';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

const statusColors = {
  pending: 'bg-rose-100 text-rose-800',
  preparing: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  served: 'bg-blue-100 text-blue-800',
  settled: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-slate-100 text-slate-800',
};

const STATUS_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#64748b'];

export default function RestaurantDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeStaff } = useStaffSession();
  const { data: dashboard, isLoading, isRefetching } = useRestaurantDashboard();
  const { data: shiftSummary } = useCurrentShiftSummary();
  const { formatCurrency } = useSettingsContext();

  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [selectedWaiter, setSelectedWaiter] = useState<any>(null);
  const { canAccessRoute, navigateIfAllowed } = useNavigationAccess();
  const canAccessHotelPos = canAccessRoute('/hotel/pos');
  const canAccessServiceMenu = canAccessRoute('/hotel/service-menu');
  const canAccessHotelReports = canAccessRoute('/hotel/reports');

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['restaurant-dashboard'] });
    toast.success("Restaurant data updated");
  };

  const isManagerial = isManagerLikeStaff(activeStaff) || ['accountant', 'receptionist'].includes(activeStaff?.role || '');

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div className="space-y-2">
              <Skeleton className="h-10 w-64" />
              <Skeleton className="h-4 w-96" />
            </div>
            <Skeleton className="h-10 w-32" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-5 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-32" />
              </Card>
            ))}
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card className="lg:col-span-2 p-6">
              <Skeleton className="h-[400px] w-full" />
            </Card>
            <Card className="p-6">
              <Skeleton className="h-[400px] w-full" />
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-6">
              <Skeleton className="h-[300px] w-full" />
            </Card>
            <Card className="p-6">
              <Skeleton className="h-[300px] w-full" />
            </Card>
          </div>
        </div>
      </Layout>
    );
  }

  const orderStatusData = dashboard ? [
    { name: 'Pending', value: dashboard.ordersByStatus.pending, color: STATUS_COLORS[0] },
    { name: 'Preparing', value: dashboard.ordersByStatus.preparing, color: STATUS_COLORS[1] },
    { name: 'Ready', value: dashboard.ordersByStatus.ready, color: STATUS_COLORS[2] },
    { name: 'Served', value: dashboard.ordersByStatus.served, color: STATUS_COLORS[3] },
    { name: 'Settled', value: dashboard.ordersByStatus.settled, color: STATUS_COLORS[4] },
  ].filter(item => item.value > 0) : [];

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Restaurant Dashboard</h1>
            <p className="text-muted-foreground">Monitor live restaurant activity and sales performance.</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="icon" 
              onClick={handleRefresh} 
              disabled={isRefetching}
              className={cn(isRefetching && "animate-spin")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {canAccessHotelPos && (
              <Button onClick={() => navigateIfAllowed('/hotel/pos')} className="gap-2">
                <Utensils className="h-4 w-4" />
                Open POS
              </Button>
            )}
          </div>
        </div>

        {/* Live Shift Insights - Advanced Logic */}
        {shiftSummary && (
          <Card className="bg-slate-900 border-none shadow-2xl overflow-hidden rounded-[2rem]">
            <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/30">
                  <Clock className="h-7 w-7 text-primary animate-pulse" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white tracking-tight uppercase">Live Shift Insights</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Real-time performance metrics for your current session</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full md:w-auto">
                <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Cash Collection</p>
                  <p className="text-lg font-black text-emerald-400 tabular-nums">{formatCurrency(shiftSummary.financial.cash)}</p>
                </div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Momo/Digital</p>
                  <p className="text-lg font-black text-blue-400 tabular-nums">{formatCurrency(shiftSummary.financial.momo + shiftSummary.financial.upi)}</p>
                </div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Active Nodes</p>
                  <p className="text-lg font-black text-amber-400 tabular-nums">{shiftSummary.activeOrders} Orders</p>
                </div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Session Sales</p>
                  <p className="text-lg font-black text-white tabular-nums">{formatCurrency(shiftSummary.financial.total_sales)}</p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-4">
          <Card 
            className="bg-white border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group overflow-hidden"
            onClick={() => setShowOrderDetails(true)}
          >
            <div className="h-1 bg-rose-500 w-full" />
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Live Orders</p>
                  <p className="text-3xl font-black tabular-nums text-slate-900">{dashboard?.todayOrders || 0}</p>
                  <p className="text-[10px] font-bold text-rose-500 mt-1 flex items-center gap-1">
                    <Activity className="h-3 w-3" /> {dashboard?.ordersByStatus.preparing || 0} in kitchen
                  </p>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500">
                  <ClipboardList className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="bg-white border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group overflow-hidden"
          >
            <div className="h-1 bg-emerald-500 w-full" />
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Today's Revenue</p>
                  <p className="text-2xl font-black tabular-nums text-slate-900 tracking-tighter">
                    {formatCurrency(dashboard?.revenueByDay?.[dashboard.revenueByDay.length-1]?.revenue || 0)}
                  </p>
                  <p className="text-[10px] font-bold text-emerald-600 mt-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Avg {formatCurrency(dashboard?.avgOrderValue || 0)} / order
                  </p>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-500">
                  <DollarSign className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className={cn(
              "bg-white border-slate-200 shadow-sm transition-all group overflow-hidden",
              canAccessHotelPos && "hover:shadow-md cursor-pointer"
            )}
            onClick={canAccessHotelPos ? () => navigateIfAllowed('/hotel/pos') : undefined}
          >
            <div className="h-1 bg-indigo-500 w-full" />
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Table Occupancy</p>
                  <p className="text-3xl font-black tabular-nums text-slate-900">{dashboard?.occupiedTables || 0}</p>
                  <p className="text-[10px] font-bold text-indigo-500 mt-1 flex items-center gap-1">
                    <Table className="h-3 w-3" /> Active dining sessions
                  </p>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-500">
                  <Utensils className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className={cn(
              "bg-white border-slate-200 shadow-sm transition-all group overflow-hidden",
              canAccessServiceMenu && "hover:shadow-md cursor-pointer",
              (dashboard?.unavailableItems || 0) > 0 && "border-amber-200"
            )}
            onClick={canAccessServiceMenu ? () => navigateIfAllowed('/hotel/service-menu') : undefined}
          >
            <div className={cn("h-1 w-full", (dashboard?.unavailableItems || 0) > 0 ? "bg-amber-500" : "bg-slate-500")} />
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Menu Health</p>
                  <p className="text-3xl font-black tabular-nums text-slate-900">{dashboard?.unavailableItems || 0}</p>
                  <p className={cn(
                    "text-[10px] font-bold mt-1 flex items-center gap-1",
                    (dashboard?.unavailableItems || 0) > 0 ? "text-amber-600" : "text-slate-400"
                  )}>
                    <AlertTriangle className="h-3 w-3" /> Items out of stock
                  </p>
                </div>
                <div className={cn(
                  "h-12 w-12 rounded-2xl flex items-center justify-center",
                  (dashboard?.unavailableItems || 0) > 0 ? "bg-amber-50 text-amber-500" : "bg-slate-50 text-slate-500"
                )}>
                  <ShoppingBag className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Revenue Chart */}
          <Card className="lg:col-span-2 border-none shadow-xl bg-white rounded-[2rem] overflow-hidden">
            <CardHeader className="bg-slate-900 text-white p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-3 text-lg font-black uppercase tracking-tight">
                  <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-emerald-400" />
                  </div>
                  Revenue Velocity
                </CardTitle>
                <Badge variant="outline" className="text-white border-white/20 font-bold uppercase tracking-widest text-[9px]">Last 7 Days</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dashboard?.revenueByDay || []}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => format(new Date(value), 'EEE')}
                      fontSize={11}
                      fontWeight="bold"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis 
                      fontSize={11} 
                      fontWeight="bold" 
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => formatCurrency(value).split('.')[0]}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                        borderRadius: '1rem', 
                        border: '1px solid #e2e8f0', 
                        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' 
                      }}
                      formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                      labelFormatter={(label) => format(new Date(label), 'MMM dd, yyyy')}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={4} fillOpacity={1} fill="url(#colorRevenue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Sales by Category Chart */}
          <Card className="border-none shadow-xl bg-white rounded-[2rem] overflow-hidden">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="flex items-center gap-3 text-lg font-black uppercase tracking-tight text-slate-900">
                <div className="h-10 w-10 rounded-xl bg-rose-50 flex items-center justify-center">
                  <PieChartIcon className="h-5 w-5 text-rose-500" />
                </div>
                Sales Mix
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 flex flex-col items-center">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dashboard?.revenueByCategory || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={8}
                      dataKey="value"
                    >
                      {(dashboard?.revenueByCategory || []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={STATUS_COLORS[index % STATUS_COLORS.length]} strokeWidth={0} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 w-full mt-2">
                {(dashboard?.revenueByCategory || []).map((entry, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-slate-50 rounded-xl">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[index % STATUS_COLORS.length] }} />
                      <span className="text-[10px] font-black uppercase text-slate-500 tracking-tight">{entry.name}</span>
                    </div>
                    <span className="text-[11px] font-black text-slate-900">{formatCurrency(entry.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Hourly Activity - "Real" Heatmap */}
          <Card className="border-none shadow-xl bg-white rounded-[2rem] overflow-hidden">
            <CardHeader className="p-6">
              <CardTitle className="flex items-center gap-3 text-lg font-black uppercase tracking-tight text-slate-900">
                <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-amber-500" />
                </div>
                Peak Hours Heatmap
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard?.busyHours || []}>
                    <XAxis 
                      dataKey="hour" 
                      fontSize={10}
                      fontWeight="bold"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide />
                    <Tooltip 
                      cursor={{fill: '#f8fafc'}}
                      contentStyle={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                        borderRadius: '1rem', 
                        border: '1px solid #e2e8f0' 
                      }}
                    />
                    <Bar 
                      dataKey="count" 
                      fill="#f59e0b" 
                      radius={[6, 6, 6, 6]} 
                      barSize={12}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-4">
                Monitor peak kitchen load times throughout the day
              </p>
            </CardContent>
          </Card>

          {/* Top Selling Items */}
          <Card className="border-none shadow-xl bg-white rounded-[2rem] overflow-hidden">
            <CardHeader className="p-6">
              <CardTitle className="flex items-center gap-3 text-lg font-black uppercase tracking-tight text-slate-900">
                <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-indigo-500" />
                </div>
                Power Sellers
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <div className="space-y-3">
                {dashboard?.topItems.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-4 bg-slate-50 rounded-[1.25rem] border border-transparent hover:border-indigo-100 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 bg-white rounded-2xl flex items-center justify-center font-black text-indigo-600 shadow-sm border border-slate-100">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-black uppercase tracking-tight text-slate-900">{item.name}</p>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{item.quantity} portions moved</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-slate-900 tracking-tight">{formatCurrency(item.revenue)}</p>
                      <Badge className="bg-indigo-100 text-indigo-700 border-none text-[8px] font-black px-1.5 py-0">BEST SELLER</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

          {/* Recent Orders */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-xl font-bold">
                <Clock className="h-5 w-5 text-indigo-500" />
                Recent Orders
              </CardTitle>
              {canAccessHotelReports && (
                <Button variant="ghost" size="sm" onClick={() => navigateIfAllowed('/hotel/reports')} className="gap-1 font-bold text-xs">
                  View All <ArrowRight className="h-3 w-3" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-4">
                  {dashboard?.recentOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-4 border rounded-2xl bg-white hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-10 w-10 rounded-xl flex items-center justify-center font-bold text-xs",
                          statusColors[order.status as keyof typeof statusColors] || "bg-slate-100"
                        )}>
                          #{order.order_number?.toString().slice(-4)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-sm uppercase tracking-tight">
                              {order.room_id ? `Room ${order.room_id.slice(0, 4)}` : order.table_number ? `Table ${order.table_number}` : 'Walk-in'}
                            </p>
                            <Badge className={cn("text-[8px] px-1.5 py-0 font-black", statusColors[order.status as keyof typeof statusColors])}>
                              {order.status.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                            {order.waiter?.first_name} • {format(new Date(order.created_at || ''), 'hh:mm a')}
                          </p>
                        </div>
                      </div>
                      <p className="font-black text-slate-900">{formatCurrency(order.total_amount)}</p>
                    </div>
                  ))}
                  {(!dashboard?.recentOrders || dashboard.recentOrders.length === 0) && (
                    <div className="py-20 text-center text-slate-300 font-bold uppercase tracking-widest">No recent activity</div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

      {/* Order Details Dialog */}
      <Dialog open={showOrderDetails} onOpenChange={setShowOrderDetails}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 bg-white font-sans">
          <DialogHeader className="p-6 border-b border-slate-100 shrink-0 bg-slate-50/50">
            <DialogTitle className="text-2xl font-black tracking-tighter text-slate-900 uppercase flex items-center gap-3">
              <ClipboardList className="h-6 w-6 text-primary" />
              Restaurant Order Analysis
            </DialogTitle>
            <DialogDescription className="font-bold text-slate-500 uppercase tracking-widest text-[10px]">
              Detailed breakdown of station performance and staff activity
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="p-6 space-y-8">
              {/* Station Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-2 border-rose-50 hover:border-rose-100 transition-colors shadow-none rounded-3xl overflow-hidden">
                  <div className="bg-rose-500 p-4 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ChefHat className="h-5 w-5" />
                      <span className="font-black uppercase tracking-widest text-xs">Kitchen Station</span>
                    </div>
                    <Badge className="bg-white/20 text-white border-none font-black">{dashboard?.stationStats.kitchen.count} Orders</Badge>
                  </div>
                  <CardContent className="p-6">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Station Revenue</span>
                      <span className="text-3xl font-black text-slate-900 tracking-tighter">
                        {formatCurrency(dashboard?.stationStats.kitchen.revenue || 0)}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-indigo-50 hover:border-indigo-100 transition-colors shadow-none rounded-3xl overflow-hidden">
                  <div className="bg-indigo-600 p-4 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Wine className="h-5 w-5" />
                      <span className="font-black uppercase tracking-widest text-xs">Bar Station</span>
                    </div>
                    <Badge className="bg-white/20 text-white border-none font-black">{dashboard?.stationStats.bar.count} Orders</Badge>
                  </div>
                  <CardContent className="p-6">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Station Revenue</span>
                      <span className="text-3xl font-black text-slate-900 tracking-tighter">
                        {formatCurrency(dashboard?.stationStats.bar.revenue || 0)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Waiter Activity List */}
              <div className="space-y-4">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Waiter Performance Breakdown
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {dashboard?.waiterStats.map((waiter: any) => (
                    <div 
                      key={waiter.id}
                      onClick={() => {
                        setSelectedWaiter(waiter);
                        setShowOrderDetails(false);
                      }}
                      className="flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 rounded-2xl cursor-pointer transition-all border border-transparent hover:border-slate-200 group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100 group-hover:scale-105 transition-transform">
                          <User className="h-6 w-6 text-slate-400" />
                        </div>
                        <div>
                          <p className="font-black text-slate-900 uppercase tracking-tight leading-none mb-1">{waiter.name}</p>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            {waiter.count} Orders Handled
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black text-slate-900 tracking-tighter leading-none mb-1">
                          {formatCurrency(waiter.revenue)}
                        </p>
                        <p className="text-[9px] font-black text-primary uppercase tracking-widest flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          View Details <ArrowRight className="h-3 w-3" />
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
          
          <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
            <Button variant="outline" onClick={() => setShowOrderDetails(false)} className="rounded-xl font-bold uppercase tracking-widest text-[10px]">
              Close Analysis
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Waiter Details Dialog */}
      <Dialog open={!!selectedWaiter} onOpenChange={(open) => !open && setSelectedWaiter(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 bg-white font-sans">
          {selectedWaiter && (
            <>
              <DialogHeader className="p-6 border-b border-slate-100 shrink-0 bg-primary/5">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 bg-white rounded-2xl flex items-center justify-center shadow-md border border-primary/10">
                    <User className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <DialogTitle className="text-2xl font-black tracking-tighter text-slate-900 uppercase">
                      {selectedWaiter.name}
                    </DialogTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className="bg-primary text-white font-black uppercase tracking-widest text-[8px] py-0 px-2">
                        Active Waiter
                      </Badge>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                        <ClipboardList className="h-3 w-3" /> {selectedWaiter.count} Total Nodes
                      </span>
                    </div>
                  </div>
                </div>
              </DialogHeader>

              <ScrollArea className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Revenue Contribution</p>
                      <p className="text-2xl font-black text-slate-900 tracking-tighter">{formatCurrency(selectedWaiter.revenue)}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Average Order Value</p>
                      <p className="text-2xl font-black text-slate-900 tracking-tighter">
                        {formatCurrency(selectedWaiter.revenue / (selectedWaiter.count || 1))}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary" />
                      Recent Activity Log
                    </h3>
                    <div className="space-y-3">
                      {selectedWaiter.orders.map((order: any) => (
                        <div key={order.id} className="p-4 border border-slate-100 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "h-10 w-10 rounded-xl flex items-center justify-center font-bold text-xs",
                              statusColors[order.status as keyof typeof statusColors] || "bg-slate-100"
                            )}>
                              #{order.order_number?.toString().slice(-4)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-black text-sm uppercase tracking-tight">
                                  {order.room_id ? `Room ${order.room_id.slice(0, 4)}` : order.table_number ? `Table ${order.table_number}` : 'Walk-in'}
                                </p>
                                <Badge className={cn("text-[7px] px-1.5 py-0 font-black", statusColors[order.status as keyof typeof statusColors])}>
                                  {order.status.toUpperCase()}
                                </Badge>
                              </div>
                              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                {format(new Date(order.created_at || ''), 'MMM dd, hh:mm a')}
                              </p>
                            </div>
                          </div>
                          <p className="font-black text-slate-900">{formatCurrency(order.total_amount)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
              
              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-between gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setSelectedWaiter(null);
                    setShowOrderDetails(true);
                  }} 
                  className="flex-1 rounded-xl font-bold uppercase tracking-widest text-[10px] gap-2"
                >
                  <ArrowRight className="h-3 w-3 rotate-180" /> Back to Analysis
                </Button>
                <Button onClick={() => setSelectedWaiter(null)} className="flex-1 rounded-xl font-bold uppercase tracking-widest text-[10px]">
                  Close Profile
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
