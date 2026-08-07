import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { X, CheckCircle2, Loader2, BedDouble, Utensils, Wine, CreditCard, ClipboardList, AlertCircle } from "lucide-react";
import { useCloseStaffShift, useShiftSummaryPreview } from "@/hooks/useHotelShifts";
import { useHotelInfo } from "@/hooks/useHotel";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface CloseShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeShift: any;
  activeStaff: any;
}

export function CloseShiftDialog({ open, onOpenChange, activeShift, activeStaff }: CloseShiftDialogProps) {
  const [closingCash, setClosingCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const { formatCurrency } = useSettingsContext();
  const { data: hotelInfo } = useHotelInfo();
  const closeShift = useCloseStaffShift();

  const { data: summaryPreview, isLoading: summaryLoading } = useShiftSummaryPreview(open ? activeShift?.id : undefined);

  const expectedCash = summaryPreview?.financial?.expected_cash || Number(activeShift?.opening_cash || 0);
  const difference = closingCash ? Number(closingCash) - expectedCash : 0;

  const handleCloseShift = async (force: boolean = false) => {
    if (!activeShift) {
      toast.error("No active shift");
      return;
    }
    if (closingCash === "") {
      toast.error("Please enter the physical cash counted");
      return;
    }
    const cashValue = Number(closingCash || 0);
    try {
      await closeShift.mutateAsync({
        shiftId: activeShift.id,
        closingCash: cashValue,
        closingNotes: closingNotes || undefined,
        forceClose: force
      });
      onOpenChange(false);
      setClosingCash("");
      setClosingNotes("");
    } catch (err: any) {
      if (err.message?.includes('pending') || err.message?.includes('unpaid')) {
        // If it's a pending orders error, we could offer force close if manager
        const isManager = activeStaff?.role === 'manager' || activeStaff?.role === 'admin' || activeStaff?.role === 'owner';
        if (isManager) {
          if (window.confirm(`${err.message} Would you like to force close this shift anyway?`)) {
            handleCloseShift(true);
          }
        } else {
          toast.error(err.message);
        }
      }
      return;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] md:w-full border-none p-0 overflow-hidden rounded-3xl bg-card" aria-describedby={undefined}>
        <div className="bg-destructive p-4 md:p-6 text-white relative shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <X className="h-6 w-6" />
            </div>
            <DialogTitle className="text-xl font-black tracking-tight uppercase">Close Shift Report</DialogTitle>
          </div>
          <p className="text-white/70 text-xs font-bold uppercase tracking-widest">Review real-time activity and end session</p>
          <div className="absolute -bottom-6 -right-6 h-32 w-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        </div>

        <div className="flex flex-col h-[85vh] md:h-auto md:max-h-[85vh]">
          <ScrollArea className="flex-1 px-4 md:px-6 py-4">
            {summaryLoading ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-4" />
                <p>Compiling real-time shift report...</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Financial Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-muted/30 rounded-2xl border border-border/50 text-sm">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Initial Float</span>
                    <span className="font-bold">{formatCurrency(Number(activeShift?.opening_cash || 0))}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Cash Sales</span>
                    <span className="font-bold text-green-600">+{formatCurrency(summaryPreview?.financial?.cash_sales || 0)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Digital/Card</span>
                    <span className="font-bold text-blue-600">{formatCurrency((summaryPreview?.financial?.momo_sales || 0) + (summaryPreview?.financial?.card_sales || 0))}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Room Charges</span>
                    <span className="font-bold text-purple-600">{formatCurrency(summaryPreview?.financial?.room_charges || 0)}</span>
                  </div>
                  <Separator className="col-span-2 md:col-span-4 my-1 opacity-50" />
                  <div className="col-span-2 md:col-span-4 flex justify-between items-center bg-card p-3 rounded-xl border shadow-sm">
                    <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Expected Drawer Cash</span>
                    <span className="text-xl font-black text-primary">{formatCurrency(expectedCash)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Hotel Activity */}
                  <div className="space-y-3 p-4 rounded-2xl border border-border/50 bg-card">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <BedDouble className="h-4 w-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Hotel Activity</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/30 p-2 rounded-lg text-center">
                        <div className="text-lg font-black">{summaryPreview?.hotel_activity?.rooms_booked || 0}</div>
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Bookings</div>
                      </div>
                      <div className="bg-muted/30 p-2 rounded-lg text-center">
                        <div className="text-lg font-black text-green-600">{summaryPreview?.hotel_activity?.check_ins || 0}</div>
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Check-ins</div>
                      </div>
                      <div className="bg-muted/30 p-2 rounded-lg text-center">
                        <div className="text-lg font-black text-orange-600">{summaryPreview?.hotel_activity?.check_outs || 0}</div>
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Check-outs</div>
                      </div>
                      <div className="bg-muted/30 p-2 rounded-lg text-center">
                        <div className="text-lg font-black text-purple-600">{summaryPreview?.hotel_activity?.payments_processed || 0}</div>
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Payments</div>
                      </div>
                    </div>
                  </div>

                  {/* POS Orders */}
                  <div className="space-y-3 p-4 rounded-2xl border border-border/50 bg-card">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <ClipboardList className="h-4 w-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">POS Orders</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/30 p-2 rounded-lg text-center">
                        <div className="text-lg font-black text-blue-600">{summaryPreview?.orders?.completed_orders || 0}</div>
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Settled</div>
                      </div>
                      <div className="bg-muted/30 p-2 rounded-lg text-center">
                        <div className="text-lg font-black text-amber-600">{summaryPreview?.orders?.pending_orders || 0}</div>
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Pending</div>
                      </div>
                      <div className="bg-muted/30 p-2 rounded-lg text-center">
                        <div className="text-lg font-black text-destructive">{summaryPreview?.orders?.cancelled_orders || 0}</div>
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Canceled</div>
                      </div>
                      <div className="bg-muted/30 p-2 rounded-lg text-center">
                        <div className="text-lg font-black text-indigo-600">{summaryPreview?.inventory?.total_items_sold || 0}</div>
                        <div className="text-[9px] uppercase font-bold text-muted-foreground">Stock Out</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stations Breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1 p-3 rounded-xl bg-orange-500/10 border border-orange-200">
                    <div className="flex items-center gap-2">
                      <Utensils className="h-4 w-4 text-orange-600" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-orange-700">Kitchen</span>
                    </div>
                    <span className="font-black text-orange-700">{formatCurrency(summaryPreview?.stations?.kitchen?.total || 0)}</span>
                  </div>
                  <div className="flex flex-col gap-1 p-3 rounded-xl bg-blue-500/10 border border-blue-200">
                    <div className="flex items-center gap-2">
                      <Wine className="h-4 w-4 text-blue-600" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-700">Bar</span>
                    </div>
                    <span className="font-black text-blue-700">{formatCurrency(summaryPreview?.stations?.bar?.total || 0)}</span>
                  </div>
                  <div className="flex flex-col gap-1 p-3 rounded-xl bg-emerald-500/10 border border-emerald-200">
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-emerald-600" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Stock</span>
                    </div>
                    <span className="font-black text-emerald-700">{formatCurrency(summaryPreview?.stations?.inventory?.total || 0)}</span>
                  </div>
                </div>

                {/* Top Inventory Items */}
                {summaryPreview?.inventory?.top_items?.length > 0 && (
                  <div className="space-y-3 p-4 rounded-2xl border border-border/50 bg-card">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Inventory Stock-Out</span>
                    </div>
                    <div className="space-y-2">
                      {summaryPreview.inventory.top_items.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-xs">
                          <span className="font-medium">{item.name}</span>
                          <span className="font-black bg-muted/50 px-2 py-0.5 rounded text-indigo-600">{item.qty} units</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Warnings / Pending Issues */}
                {((summaryPreview?.orders?.pending_orders || 0) > 0 || (summaryPreview?.orders?.unpaid_details?.length || 0) > 0) && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-200 space-y-2">
                    <div className="flex items-center gap-2 text-amber-700 font-bold text-sm">
                      <AlertCircle className="h-4 w-4" />
                      Attention Required
                    </div>
                    <ul className="text-xs text-amber-700/80 list-disc list-inside pl-5">
                      {(summaryPreview?.orders?.pending_orders || 0) > 0 && (
                        <li>{summaryPreview.orders.pending_orders} orders are still pending/preparing</li>
                      )}
                      {(summaryPreview?.orders?.unpaid_details?.length || 0) > 0 && (
                        <li>{summaryPreview.orders.unpaid_details.length} orders are billed but not paid</li>
                      )}
                    </ul>
                  </div>
                )}
                
                <Separator />
                
                {/* Cash Entry */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 text-destructive">Physical Cash Counted</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        value={closingCash}
                        onChange={(e) => setClosingCash(e.target.value)}
                        min={0}
                        placeholder="0.00"
                        className="text-3xl text-center font-black h-20 rounded-2xl bg-muted/30 border-none focus-visible:ring-destructive focus-visible:ring-offset-0"
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-black opacity-20 text-xl">
                        {hotelInfo?.currency || 'RWF'}
                      </div>
                    </div>
                    {closingCash && (
                      <div className={`text-[10px] font-black uppercase tracking-widest flex justify-between p-3 rounded-xl animate-in slide-in-from-top-2 ${difference === 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'}`}>
                        <span>Discrepancy:</span>
                        <span>{difference > 0 ? '+' : ''}{formatCurrency(difference)}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Closing Notes</Label>
                    <Textarea
                      placeholder="Explain any discrepancies or significant events..."
                      value={closingNotes}
                      onChange={(e) => setClosingNotes(e.target.value)}
                      className="rounded-2xl bg-muted/30 border-none resize-none focus-visible:ring-destructive focus-visible:ring-offset-0"
                    />
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>

          <div className="p-6 pt-4 border-t bg-card shrink-0">
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-14 rounded-2xl font-black border-dashed">
                GO BACK
              </Button>
              <Button 
                onClick={handleCloseShift} 
                disabled={closeShift.isPending || summaryLoading || !closingCash} 
                className="flex-[2] h-14 rounded-2xl bg-destructive hover:bg-destructive/90 font-black shadow-xl shadow-destructive/20"
              >
                {closeShift.isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
                END SHIFT
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}