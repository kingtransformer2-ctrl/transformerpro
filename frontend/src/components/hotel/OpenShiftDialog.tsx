import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOpenStaffShift } from "@/hooks/useHotelShifts";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { toast } from "sonner";
import { Clock, Plus, Loader2 } from "lucide-react";

interface OpenShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function OpenShiftDialog({ open, onOpenChange, onSuccess }: OpenShiftDialogProps) {
  const [openingCash, setOpeningCash] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const { activeStaff, refreshActiveShift } = useStaffSession();
  const openShift = useOpenStaffShift();

  const handleOpenShift = async () => {
    if (!activeStaff) {
      toast.error("Staff not logged in");
      return;
    }
    
    const cashValue = openingCash === "" ? 0 : Number(openingCash);
    try {
      await openShift.mutateAsync({
        shiftLabel: `${activeStaff.first_name}'s Shift`,
        openingCash: cashValue,
        openingNotes: openingNotes || undefined,
      });
      
      await refreshActiveShift();
      onOpenChange(false);
      setOpeningCash("");
      setOpeningNotes("");
      if (onSuccess) onSuccess();
    } catch (err) {
      // Error handled by mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-none p-0 overflow-hidden rounded-3xl bg-card" aria-describedby={undefined}>
        <div className="bg-primary p-6 text-white relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <Clock className="h-6 w-6" />
            </div>
            <DialogTitle className="text-xl font-black tracking-tight uppercase">Open New Shift</DialogTitle>
          </div>
          <p className="text-white/70 text-xs font-bold uppercase tracking-widest">Set your opening float and start session</p>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Opening Cash Float</Label>
              <div className="relative">
                <Input
                  type="number"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  min={0}
                  placeholder="0.00"
                  className="text-2xl font-black h-14 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary focus-visible:ring-offset-0"
                />
              </div>
              <p className="text-[10px] text-muted-foreground ml-1 italic">The total cash currently in your drawer.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Shift Notes (Optional)</Label>
              <Textarea
                placeholder="Any specific instructions or notes for this shift..."
                value={openingNotes}
                onChange={(e) => setOpeningNotes(e.target.value)}
                className="rounded-2xl bg-muted/30 border-none resize-none focus-visible:ring-primary focus-visible:ring-offset-0 min-h-[100px]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Button 
              onClick={handleOpenShift} 
              disabled={openShift.isPending} 
              className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 font-black shadow-lg text-white border-none"
            >
              {openShift.isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Plus className="h-5 w-5 mr-2" />}
              START SHIFT NOW
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full h-12 rounded-2xl font-bold text-muted-foreground">
              CANCEL
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
