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
  Clock, CheckCircle2, XCircle, BedDouble, User, MessageSquare,
  RefreshCw, Bell, Wine, Menu, FileText, LogOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import type { OrderStatus } from '@/types/hotel';
import { isManagerLikeStaff } from '@/lib/hotelAccess';

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'New', color: 'bg-yellow-500', icon: Clock },
  preparing: { label: 'Preparing', color: 'bg-blue-500', icon: Wine },
  ready: { label: 'Ready', color: 'bg-green-500', icon: CheckCircle2 },
  served: { label: 'Served', color: 'bg-muted', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', color: 'bg-destructive', icon: XCircle },
};

export function BarDisplay() {
  const { activeStaff, isStaffLoggedIn, logoutStaff, activeShift, isShiftActive, refreshActiveShift } = useStaffSession();
  const { data: orders = [], isLoading, refetch } = useActiveOrders();
  const updateOrderStatus = useUpdateOrderStatus();
  const updateItemStatus = useUpdateOrderItemStatus();
  
  const [readyNotified, setReadyNotified] = useState<Set<string>>(new Set());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showOpenShiftDialog, setShowOpenShiftDialog] = useState(false);
  const [showCloseShiftDialog, setShowCloseShiftDialog] = useState(false);
  const [showManagerAuth, setShowManagerAuth] = useState(false);
  const [view, setView] = useState<'active' | 'report'>('active');
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Filter orders that have bar items
  const barOrders = useMemo(() => {
    return orders.filter(order => {
      if (!order.items || order.items.length === 0) return false;
      return order.items.some((item: any) => item.station === 'bar');
    });
  }, [orders]);

  // Notification for new bar orders
  useEffect(() => {
    const pendingOrders = barOrders.filter(o => o.bar_status === 'pending');
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

          if (Notification.permission === 'granted') {
            new Notification('New Bar Order!', {
              body: `${newOrders.length} new bar order(s) received`,
              icon: '/favicon.ico',
              tag: 'new-orders-bar',
            });
          }
          const next = new Set(prev);
          newOrders.forEach(o => next.add(o.id));
          return next;
        }
        return prev;
      });
    }
  }, [barOrders]);

  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Get only bar items from an order
  function getBarItems(order: any) {
    return (order.items || []).filter((item: any) => item.station === 'bar');
  }

  const handleStatusChange = (orderId: string, status: OrderStatus) => {
    // No shift check needed! Auto-approve everything
    updateOrderStatus.mutate({ orderId, status, station: 'bar', shiftId: activeShift?.id, staffId: activeStaff?.staff_id || null });
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

  const pendingOrders = barOrders.filter(o => o.bar_status === 'pending');
  const preparingOrders = barOrders.filter(o => o.bar_status === 'preparing');
  const readyOrders = barOrders.filter(o => o.bar_status === 'ready');

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

        <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Wine className="h-6 w-6 text-purple-400" />
              Bar Display
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
                view === 'report' ? "bg-purple-600 hover:bg-purple-700" : "text-white border-slate-600 hover:bg-slate-700"
              )}
            >
              <FileText className="h-4 w-4" />
              {view === 'active' ? 'Reports' : 'Back to Orders'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {view === 'active' ? (
              <>
                <Badge variant="destructive" className="text-sm px-3 py-1 bg-red-600 animate-pulse">
                  {pendingOrders.length} New
                </Badge>
                <Badge variant="secondary" className="text-sm px-3 py-1 bg-purple-600 text-white border-none">
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
                <Badge className="bg-purple-600 text-white animate-in fade-in">Report View Active</Badge>
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
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {barOrders
                .filter(o => ['pending', 'preparing', 'ready'].includes(o.bar_status))
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                .map(order => {
                  const config = statusConfig[order.bar_status] || statusConfig.pending;
                  const StatusIcon = config.icon;
                  const timeAgo = formatDistanceToNow(new Date(order.created_at), { addSuffix: true });
                  const barItems = getBarItems(order);

                  return (
                    <Card key={order.id} className={`bg-slate-800 border-2 ${
                      order.bar_status === 'pending' ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]' :
                      order.bar_status === 'preparing' ? 'border-purple-500' :
                      order.bar_status === 'ready' ? 'border-green-500 opacity-60' : 'border-slate-700'
                    }`}>
                      <CardHeader className="pb-2 pt-3 px-4 bg-slate-800/50 rounded-t-lg">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg text-white">#{order.order_number}</CardTitle>
                          <Badge className={`${config.color} text-white border-none`}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {config.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-400">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {timeAgo}
                          </span>
                          {order.room && (
                            <span className="flex items-center gap-1">
                              <BedDouble className="h-3 w-3" />
                              R {order.room.room_number}
                            </span>
                          )}
                          {order.table_number && (
                            <span className="font-bold text-purple-400">T {order.table_number}</span>
                          )}
                        </div>
                      </CardHeader>

                      <Separator className="bg-slate-700" />

                      <CardContent className="pt-3 px-4 pb-3">
                        <div className="space-y-2 mb-3">
                          {barItems.map((item: any) => (
                            <div key={item.id} className={cn(
                              "flex items-start justify-between gap-2 p-2 rounded transition-all",
                              item.status === 'cancelled' ? "bg-red-500/20 border border-red-500/30" : "bg-slate-900/50"
                            )}>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    "font-black text-xl",
                                    item.status === 'cancelled' ? "text-red-400" : "text-purple-400"
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
                                  <div className="flex items-center gap-1 text-sm text-yellow-400 font-medium mt-1 p-1 bg-yellow-400/10 rounded">
                                    <MessageSquare className="h-3 w-3" />
                                    {item.notes}
                                  </div>
                                )}
                              </div>
                              {order.bar_status === 'preparing' && item.status !== 'ready' && item.status !== 'cancelled' && (
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

                        {order.notes && (
                          <div className="text-sm bg-slate-900 p-2 rounded mb-3 text-slate-300 border border-slate-700">
                            <strong className="text-purple-400">Note:</strong> {order.notes}
                          </div>
                        )}

                        <div className="flex gap-2">
                          {order.bar_status === 'pending' && (
                            <>
                              <Button className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold" onClick={() => handleStatusChange(order.id, 'preparing')}>
                                START PREPARING
                              </Button>
                              <Button variant="destructive" size="icon" onClick={() => { setCancelOrderId(order.id); setCancelReason(""); }}>
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {order.bar_status === 'preparing' && (
                            <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold" onClick={() => handleStatusChange(order.id, 'ready')}>
                              MARK ALL READY
                            </Button>
                          )}
                          {order.bar_status === 'ready' && (
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

              {barOrders.filter(o => ['pending', 'preparing', 'ready'].includes(o.bar_status)).length === 0 && (
                <div className="col-span-full text-center py-20 text-muted-foreground">
                  <Wine className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p className="text-lg font-medium">No active bar orders</p>
                  <p className="text-sm">Waiting for new drink orders...</p>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          <StationReport 
            station="bar" 
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
          description="A manager PIN is required to cancel orders older than 10 minutes or from the bar."
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

export default BarDisplay;
