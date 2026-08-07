import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ShieldCheck, Loader2, X, Delete } from "lucide-react";
import { cn } from "@/lib/utils";

interface ManagerAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (managerId: string) => void;
  title?: string;
  description?: string;
}

export function ManagerAuthDialog({ 
  open, 
  onOpenChange, 
  onSuccess, 
  title = "Manager Authorization Required",
  description = "Please enter a Manager PIN to authorize this sensitive action."
}: ManagerAuthDialogProps) {
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const handleDigit = (digit: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + digit);
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await apiClient.rpc('verify_staff_pin', { staff_pin: pin });
      if (error) throw error;

      const result = data as any;
      if (result.success && ['manager', 'admin', 'owner'].includes(result.role?.toLowerCase())) {
        toast.success(`Authorized by ${result.first_name}`);
        onSuccess(result.staff_id);
        onOpenChange(false);
        setPin("");
      } else {
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setPin("");
        toast.error(result.success ? "This action requires Manager privileges" : "Invalid PIN");
      }
    } catch (err: any) {
      toast.error(err.message || "Authorization failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-submit
  useEffect(() => {
    if (pin.length === 6) handleSubmit();
  }, [pin]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-none p-0 overflow-hidden rounded-[2.5rem] bg-card shadow-2xl">
        <div className="bg-slate-900 p-6 text-white relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-xl font-black tracking-tight uppercase italic">Security <span className="text-primary not-italic">OVERRIDE</span></DialogTitle>
          </div>
          <DialogDescription className="text-slate-400 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
            {description}
          </DialogDescription>
        </div>

        <div className="p-8 space-y-8">
          {/* PIN dots display */}
          <div className={cn("flex justify-center gap-4", shake && "animate-shake")}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "w-3.5 h-3.5 rounded-full border-2 transition-all duration-300",
                  i < pin.length
                    ? 'bg-primary border-primary scale-125 shadow-[0_0_15px_rgba(var(--primary),0.6)]'
                    : 'border-slate-200'
                )}
              />
            ))}
          </div>

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
              <Button
                key={digit}
                variant="ghost"
                className="h-14 text-xl font-black text-slate-700 bg-slate-50 hover:bg-primary hover:text-white rounded-2xl border border-slate-100 transition-all active:scale-90"
                onClick={() => handleDigit(digit)}
                disabled={isLoading}
              >
                {digit}
              </Button>
            ))}
            <Button
              variant="ghost"
              className="h-14 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-500 bg-slate-50 rounded-2xl border border-slate-100 transition-all"
              onClick={() => setPin("")}
              disabled={isLoading}
            >
              Clear
            </Button>
            <Button
              key="0"
              variant="ghost"
              className="h-14 text-xl font-black text-slate-700 bg-slate-50 hover:bg-primary hover:text-white rounded-2xl border border-slate-100 transition-all active:scale-90"
              onClick={() => handleDigit('0')}
              disabled={isLoading}
            >
              0
            </Button>
            <Button
              variant="ghost"
              className="h-14 flex items-center justify-center text-slate-400 hover:text-rose-500 bg-slate-50 rounded-2xl border border-slate-100 transition-all active:scale-90"
              onClick={handleDelete}
              disabled={isLoading}
            >
              <Delete className="h-5 w-5" />
            </Button>
          </div>

          <Button
            className="w-full h-14 text-sm font-black uppercase tracking-widest bg-primary hover:bg-primary/90 text-white rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-95"
            onClick={handleSubmit}
            disabled={pin.length < 4 || isLoading}
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Verify Identity"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
