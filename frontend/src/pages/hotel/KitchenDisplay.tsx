import { useState, useEffect, useMemo } from 'react';
import { cn } from "@/lib/utils";
import { Sidebar } from '@/components/layout/Sidebar';
import { StaffPinLogin } from '@/components/hotel/StaffPinLogin';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { useActiveOrders, useUpdateOrderStatus, useUpdateOrderItemStatus } from '@/hooks/useHotelOrders';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { CloseShiftDialog } from "@/components/hotel/CloseShiftDialog";
import { OpenShiftDialog } from "@/components/hotel/OpenShiftDialog";
import { ManagerAuthDialog } from "@/components/hotel/ManagerAuthDialog";
import { StationReport } from './components/StationReport';
import {
  Clock,
  CheckCircle2,
  XCircle,
  BedDouble,
  User,
  MessageSquare,
  RefreshCw,
  Bell,
  Wine,
  Utensils,
  ChefHat,
  Menu,
  FileText,
  LogOut,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { formatDistanceToNow, differenceInMinutes } from 'date-fns';
import type { OrderStatus } from '@/types/hotel';
import { isManagerLikeStaff } from '@/lib/hotelAccess';

// Add urgency levels
const URGENCY_LEVELS = {
  NORMAL: 10, // minutes
  WARNING: 15, // minutes
  CRITICAL: 20, // minutes
};

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'New', color: 'bg-yellow-500', icon: Clock },
  preparing: { label: 'Preparing', color: 'bg-blue-500', icon: ChefHat },
  ready: { label: 'Ready', color: 'bg-green-500', icon: CheckCircle2 },
  served: { label: 'Served', color: 'bg-muted', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', color: 'bg-destructive', icon: XCircle },
};

function PrepTimer({ createdAt, preparingStartedAt, status }: { createdAt: string, preparingStartedAt?: string, status: string }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const totalWaitMinutes = differenceInMinutes(now, new Date(createdAt));
  const prepMinutes = preparingStartedAt ? differenceInMinutes(now, new Date(preparingStartedAt)) : null;

  let urgencyColor = "text-slate-400";
  if (status !== 'ready' && status !== 'served' && status !== 'cancelled') {
    if (totalWaitMinutes >= URGENCY_LEVELS.CRITICAL) urgencyColor = "text-red-500 font-black animate-pulse";
    else if (totalWaitMinutes >= URGENCY_LEVELS.WARNING) urgencyColor = "text-orange-500 font-bold";
    else if (totalWaitMinutes >= URGENCY_LEVELS.NORMAL) urgencyColor = "text-yellow-500";
  }

  return (
    <div className="flex flex-col items-end">
      <div className={cn("flex items-center gap-1 text-xs", urgencyColor)}>
        <Clock className="h-3.5 w-3.5" />
        <span>Wait: {totalWaitMinutes}m</span>
      </div>
      {prepMinutes !== null && status === 'preparing' && (
        <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mt-0.5">
          Prep: {prepMinutes}m
        </div>
      )}
    </div>
  );
}

function getSeatGroupLabel(item: any) {
  if (item.seat_no) {
    return `Seat ${item.seat_no}`;
  }
  if (item.seat_id) {
    return 'Assigned Seat';
  }
  return 'Unassigned';
}

function getSeatGroupKey(item: any) {
  if (item.seat_no) {
    return `seat-${item.seat_no}`;
  }
  if (item.seat_id) {
    return `seat-id-${item.seat_id}`;
  }
  return 'unassigned';
}

export function KitchenDisplay() {
  const { activeStaff, isStaffLoggedIn, logoutStaff, activeShift, isShiftActive, refreshActiveShift } = useStaffSession();
  const { data: orders = [], isLoading, refetch } = useActiveOrders();
  const updateOrderStatus = useUpdateOrderStatus();
  const updateItemStatus = useUpdateOrderItemStatus();
  
  const [readyNotified, setReadyNotified] = useState<Set<string>>(new Set());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showOpenShiftDialog, setShowOpenShiftDialog] = useState(false);
  const [showCloseShiftDialog, setShowCloseShiftDialog] = useState(false);
  const [showManagerAuth, setShowManagerAuth] = useState(false);
  const [activeTab, setActiveTab] = useState<'tickets' | 'production'>('tickets');
  const [view, setView] = useState<'active' | 'report'>('active');
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Filter items within an order by station
  const getStationItems = (order: any) => {
    return (order.items || []).filter((item: any) => item.station === 'kitchen');
  };

  // Filter orders by station - an order shows in a station if it has items for that station
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      if (!order.items || order.items.length === 0) return false;
      return order.items.some(item => item.station === 'kitchen');
    });
  }, [orders]);

  // Sound notification when new order arrives
  useEffect(() => {
    const pendingOrders = filteredOrders.filter(o => o.kitchen_status === 'pending');
    if (pendingOrders.length > 0) {
      setReadyNotified(prev => {
        const newOrders = pendingOrders.filter(o => !prev.has(o.id));
        if (newOrders.length > 0) {
          // Sound Alert
          const playSound = async () => {
            try {
              const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
              await audio.play();
            } catch (e) {
              console.log('Audio notification skipped:', e);
            }
          };
          playSound();

          // Browser notification
          if (Notification.permission === 'granted') {
            new Notification('New Kitchen Order!', {
              body: `${newOrders.length} new kitchen order(s) received`,
              icon: '/favicon.ico',
              tag: 'new-orders-kitchen',
            });
          }
          
          const next = new Set(prev);
          newOrders.forEach(o => next.add(o.id));
          return next;
        }
        return prev;
      });
    }
  }, [filteredOrders]);

  // Request notification permission
  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const handleStatusChange = (orderId: string, status: OrderStatus) => {
    // No shift check needed! Auto-approve everything
    updateOrderStatus.mutate({ orderId, status, station: 'kitchen', shiftId: activeShift?.id, staffId: activeStaff?.staff_id || null });
  };

  const handleItemReady = (itemId: string) => {
    // No shift check needed!
    updateItemStatus.mutate({ itemId, status: 'ready' });
  };

  const submitCancelOrder = async (managerId?: string) => {
    if (!cancelOrderId) return;
    
    const order = orders.find(o => o.id === cancelOrderId);
    const orderAgeMs = order ? Date.now() - new Date(order.created_at).getTime() : 0;
    const isOldOrder = orderAgeMs > 10 * 60 * 1000; // 10 minutes

    const requiresManagerAuth = isOldOrder || !isManagerLikeStaff(activeStaff);
    if (requiresManagerAuth && !managerId) {
      setShowManagerAuth(true);
      return;
    }

    if (!cancelReason.trim()) {
      toast.error('Provide a cancellation reason');
      return;
    }
    // No shift check needed!
    updateOrderStatus.mutate({
      orderId: cancelOrderId,
      status: 'cancelled',
      cancelReason: cancelReason.trim(),
      staffId: managerId || activeStaff?.staff_id || null,
      shiftId: activeShift?.id,
    });
    setCancelOrderId(null);
    setCancelReason("");
  };

  // Group filtered orders by status
  const pendingOrders = filteredOrders.filter(o => o.kitchen_status === 'pending');
  const preparingOrders = filteredOrders.filter(o => o.kitchen_status === 'preparing');
  const readyOrders = filteredOrders.filter(o => o.kitchen_status === 'ready');

  // Consolidated Production View Logic
  const productionItems = useMemo(() => {
    const activeOrders = filteredOrders.filter(o => ['pending', 'preparing'].includes(o.kitchen_status));
    const itemCounts: Record<string, { name: string; quantity: number; orders: string[] }> = {};
    
    activeOrders.forEach(order => {
      const items = getStationItems(order).filter((i: any) => i.status !== 'ready' && i.status !== 'cancelled');
      items.forEach((item: any) => {
        if (!itemCounts[item.name]) {
          itemCounts[item.name] = { name: item.name, quantity: 0, orders: [] };
        }
        itemCounts[item.name].quantity += Number(item.quantity);
        const seatLabel = getSeatGroupLabel(item);
        itemCounts[item.name].orders.push(`#${order.order_number} • ${seatLabel}`);
      });
    });
    
    return Object.values(itemCounts).sort((a, b) => b.quantity - a.quantity);
  }, [filteredOrders]);

  return (
    <>
      <style>{`
        html, body {
          background-color: #0f172a !important;
          margin: 0 !important;
          padding: 0 !important;
          height: 100% !important;
          width: 100% !important;
          overflow: hidden !important;
        }
        #root {
          height: 100% !important;
        }
      `}</style>
      <div className="fixed inset-0 z-[40] flex flex-col overflow-hidden bg-slate-900 w-full h-full" style={{ height: '100vh' }}>
        {/* Desktop Sidebar Hover Zone */}
        <div className="hidden md:block fixed left-0 top-0 w-4 h-full z-[10000] group">
          <div className="fixed left-0 top-0 h-full z-[10001] -translate-x-full group-hover:translate-x-0 transition-transform duration-300 ease-in-out">
            <Sidebar />
          </div>
        </div>

        {/* Mobile Sidebar Toggle */}
        <div className="md:hidden fixed left-2 top-2 z-[10000]">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="bg-slate-800/80 backdrop-blur-sm border-slate-700 text-white hover:bg-slate-700">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 bg-slate-900 border-slate-800">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <div className="h-full overflow-y-auto" onClick={() => setMobileMenuOpen(false)}>
                <Sidebar />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Header */}
         <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <ChefHat className="h-6 w-6 text-orange-500" />
              Kitchen Display
            </h1>
            {activeShift ? (
              <Badge className="bg-green-600">Shift Active</Badge>
            ) : (
              <Badge variant="destructive">Shift Closed</Badge>
            )}
            {activeShift ? (
              <Button variant="outline" size="sm" onClick={() => setShowCloseShiftDialog(true)} className="text-white border-slate-600 hover:bg-slate-700">
                Close Shift
              </Button>
            ) : (
              <Button size="sm" onClick={() => setShowOpenShiftDialog(true)}>
                Open Shift
              </Button>
            )}
            <Button 
              variant={view === 'report' ? "default" : "outline"} 
              size="sm" 
              onClick={() => setView(view === 'active' ? 'report' : 'active')} 
              className={cn(
                "gap-2",
                view === 'report' ? "bg-orange-600 hover:bg-orange-700" : "text-white border-slate-600 hover:bg-slate-700"
              )}
            >
              <FileText className="h-4 w-4" />
              {view === 'active' ? 'Reports' : 'Back to Orders'}
            </Button>
            
            {view === 'active' && (
              <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="ml-0 md:ml-4">
                <TabsList className="bg-slate-900 border border-slate-700">
                  <TabsTrigger value="tickets" className="data-[state=active]:bg-orange-600 data-[state=active]:text-white">Tickets</TabsTrigger>
                  <TabsTrigger value="production" className="data-[state=active]:bg-orange-600 data-[state=active]:text-white">Production</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {view === 'active' ? (
              <>
                <Badge variant="destructive" className="text-sm px-3 py-1 bg-red-600 animate-pulse">
                  {pendingOrders.length} New
                </Badge>
                <Badge variant="secondary" className="text-sm px-3 py-1 bg-blue-600 text-white border-none">
                  {preparingOrders.length} Preparing
                </Badge>
                <Badge className="text-sm px-3 py-1 bg-green-600 text-white">
                  {readyOrders.length} Ready
                </Badge>
                <Button variant="outline" size="sm" onClick={() => refetch()} className="text-white border-slate-600 hover:bg-slate-700">
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Refresh
                </Button>
                <Button variant="ghost" size="icon" onClick={logoutStaff} className="text-white hover:bg-slate-700/50 rounded-full" title="Logout Staff">
                  <LogOut className="h-5 w-5 text-red-400" />
                </Button>
              </>
            ) : (
              <>
                <Badge className="bg-orange-600 text-white animate-in fade-in">Report View Active</Badge>
                <Button variant="ghost" size="icon" onClick={logoutStaff} className="text-white hover:bg-slate-700/50 rounded-full" title="Logout Staff">
                  <LogOut className="h-5 w-5 text-red-400" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Content View Switch */}
        {view === 'active' ? (
          <ScrollArea className="flex-1">
            {activeTab === 'tickets' ? (
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredOrders
                  .filter(o => ['pending', 'preparing', 'ready'].includes(o.kitchen_status))
                  .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                  .map(order => {
                    const config = statusConfig[order.kitchen_status] || statusConfig.pending;
                    const StatusIcon = config.icon;
                    const items = getStationItems(order);
                    const seatGroups = items.reduce((groups: Array<{ key: string; label: string; seatNo: number | null; items: any[] }>, item: any) => {
                      const key = getSeatGroupKey(item);
                      const existing = groups.find((group) => group.key === key);
                      if (existing) {
                        existing.items.push(item);
                        return groups;
                      }

                      groups.push({
                        key,
                        label: getSeatGroupLabel(item),
                        seatNo: item.seat_no || null,
                        items: [item],
                      });
                      return groups;
                    }, []).sort((left, right) => {
                      if (left.seatNo === null && right.seatNo === null) return left.label.localeCompare(right.label);
                      if (left.seatNo === null) return 1;
                      if (right.seatNo === null) return -1;
                      return left.seatNo - right.seatNo;
                    });

                    return (
                      <Card key={order.id} className={`bg-slate-800 border-2 ${
                        order.kitchen_status === 'pending' ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]' :
                        order.kitchen_status === 'preparing' ? 'border-blue-500' :
                        order.kitchen_status === 'ready' ? 'border-green-500 opacity-60' : 'border-slate-700'
                      }`}>
                        <CardHeader className="pb-2 pt-3 px-4 bg-slate-800/50 rounded-t-lg">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg text-white">#{order.order_number}</CardTitle>
                            <PrepTimer 
                              createdAt={order.created_at} 
                              preparingStartedAt={order.preparing_started_at} 
                              status={order.kitchen_status} 
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              {order.room && (
                                <span className="flex items-center gap-1 bg-slate-900 px-2 py-0.5 rounded">
                                  <BedDouble className="h-3 w-3" />
                                  RM {order.room.room_number}
                                </span>
                              )}
                              {order.table_number && (
                                <span className="bg-orange-600/20 text-orange-400 px-2 py-0.5 rounded">TBL {order.table_number}</span>
                              )}
                            </div>
                            <Badge className={`${config.color} text-white border-none text-[9px] uppercase font-black tracking-widest px-2 py-0.5`}>
                              {config.label}
                            </Badge>
                          </div>
                        </CardHeader>

                        <Separator className="bg-slate-700" />

                        <CardContent className="pt-3 px-4 pb-3">
                          {/* Order Items */}
                          <div className="space-y-3 mb-3">
                            {seatGroups.map((group) => (
                              <div key={group.key} className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-2.5">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <Badge variant="outline" className="border-orange-500/40 bg-orange-500/10 text-orange-300">
                                    {group.label}
                                  </Badge>
                                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                                    {group.items.length} item{group.items.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  {group.items.map((item: any) => (
                                    <div key={item.id} className={cn(
                                      "flex items-start justify-between gap-2 p-2 rounded transition-all",
                                      item.status === 'cancelled' ? "bg-red-500/20 border border-red-500/30" : "bg-slate-950/60"
                                    )}>
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                          <span className={cn(
                                            "font-black text-xl",
                                            item.status === 'cancelled' ? "text-red-400" : "text-orange-500"
                                          )}>{item.quantity}×</span>
                                          <span className={cn(
                                            "font-bold text-slate-200",
                                            (item.status === 'ready' || item.status === 'cancelled') && "line-through text-slate-500"
                                          )}>
                                            {item.name}
                                            {item.status === 'cancelled' && <span className="text-red-500 ml-1 font-black animate-pulse">!!! CANCELLED !!!</span>}
                                          </span>
                                        </div>
                                        {item.notes && (
                                          <div className="flex items-center gap-1 text-sm text-red-400 font-medium mt-1 p-1 bg-red-400/10 rounded">
                                            <MessageSquare className="h-3 w-3" />
                                            {item.notes}
                                          </div>
                                        )}
                                      </div>
                                      {order.kitchen_status === 'preparing' && item.status !== 'ready' && item.status !== 'cancelled' && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="shrink-0 text-green-400 border-green-400 hover:bg-green-400 hover:text-white"
                                          onClick={() => handleItemReady(item.id)}
                                        >
                                          Done
                                        </Button>
                                      )}
                                      {item.status === 'ready' && (
                                        <Badge variant="outline" className="text-green-400 border-green-400">
                                          ✓
                                        </Badge>
                                      )}
                                      {item.status === 'cancelled' && (
                                        <Badge variant="outline" className="text-red-400 border-red-400">
                                          X
                                        </Badge>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>

                          {order.notes && (
                            <div className="text-sm bg-slate-900 p-2 rounded mb-3 text-slate-300 border border-slate-700">
                              <strong className="text-orange-400">Note:</strong> {order.notes}
                            </div>
                          )}

                          {/* Action Buttons */}
                          <div className="flex gap-2">
                            {order.kitchen_status === 'pending' && (
                              <>
                                <Button
                                  className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold"
                                  onClick={() => handleStatusChange(order.id, 'preparing')}
                                >
                                  START PREPARING
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  onClick={() => { setCancelOrderId(order.id); setCancelReason(""); }}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {order.kitchen_status === 'preparing' && (
                              <Button
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold"
                                onClick={() => handleStatusChange(order.id, 'ready')}
                              >
                                MARK ALL READY
                              </Button>
                            )}
                            {order.kitchen_status === 'ready' && (
                              <div className="w-full text-center py-2 text-green-500 font-bold flex items-center justify-center gap-2">
                                <CheckCircle2 className="h-5 w-5" />
                                READY FOR PICKUP
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}

                {filteredOrders.filter(o => ['pending', 'preparing', 'ready'].includes(o.kitchen_status)).length === 0 && (
                  <div className="col-span-full text-center py-20 text-muted-foreground">
                    <ChefHat className="h-16 w-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg font-medium">No active kitchen orders</p>
                    <p className="text-sm">Waiting for new orders from waiters...</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {productionItems.map((item, idx) => (
                  <Card key={idx} className="bg-slate-800 border-slate-700 overflow-hidden shadow-lg hover:border-orange-500/50 transition-colors">
                    <CardHeader className="bg-slate-900/50 pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-2xl font-black text-white">{item.name}</CardTitle>
                        <div className="h-12 w-12 rounded-2xl bg-orange-600 flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-orange-900/20">
                          {item.quantity}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Requested in tickets:</p>
                      <div className="flex flex-wrap gap-2">
                        {item.orders.map((on, i) => (
                          <Badge key={i} variant="outline" className="bg-slate-900 border-slate-700 text-slate-300 font-bold">
                            {on}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {productionItems.length === 0 && (
                  <div className="col-span-full text-center py-20 text-muted-foreground">
                    <Utensils className="h-16 w-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg font-medium">No items in production</p>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        ) : (
          <StationReport 
            station="kitchen" 
            onClose={() => setView('active')}
          />
        )}

        <OpenShiftDialog 
          open={showOpenShiftDialog} 
          onOpenChange={setShowOpenShiftDialog}
        />

        <CloseShiftDialog 
          open={showCloseShiftDialog} 
          onOpenChange={setShowCloseShiftDialog}
          activeShift={activeShift}
          activeStaff={activeStaff}
        />

        <ManagerAuthDialog
          open={showManagerAuth}
          onOpenChange={setShowManagerAuth}
          onSuccess={(managerId) => submitCancelOrder(managerId)}
          description="A manager PIN is required to cancel orders older than 10 minutes or from the kitchen."
        />

        <Dialog open={!!cancelOrderId} onOpenChange={(open) => !open && setCancelOrderId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cancel Order</DialogTitle>
              <DialogDescription>Please provide a reason for cancelling this order.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setCancelOrderId(null)}>Back</Button>
              <Button variant="destructive" onClick={submitCancelOrder}>
                Cancel Order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

export default KitchenDisplay;
