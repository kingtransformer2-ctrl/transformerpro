import { useState, useEffect } from 'react';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Utensils, Lock, Delete, LogIn, ChefHat, Sparkles, Clock, ShieldCheck, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useNavigationAccess } from '@/hooks/useNavigationAccess';
import { useAuth } from '@/contexts/AuthContext';
import { getStaffHomeRouteCandidates, resolveStaffHomeRoute } from '@/lib/hotelAccess';

export function StaffPinLogin() {
  const { loginWithPin, activeStaff, logoutStaff } = useStaffSession();
  const { signOut } = useAuth();
  const { findFirstAccessibleRoute, navigateIfAllowed, showAccessDenied } = useNavigationAccess();
  const [pin, setPin] = useState('');
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

  const handleClear = () => {
    setPin('');
  };

  const handleSubmit = async () => {
    if (isLoading) {
      return;
    }

    if (pin.length < 4) {
      toast.error('PIN must be at least 4 digits');
      return;
    }

    setIsLoading(true);
    const result = await loginWithPin(pin);
    setIsLoading(false);

    if (!result.success) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPin('');
      toast.error(result.error || 'Invalid PIN');
    } else {
      toast.success('Welcome back!');
      // Redirection logic based on role will be handled by the useEffect
    }
  };

  // Handle redirection after successful login
  useEffect(() => {
    if (activeStaff) {
      const resolvedHomeRoute = resolveStaffHomeRoute(activeStaff);
      const fallbackRoute = findFirstAccessibleRoute([
        resolvedHomeRoute,
        ...getStaffHomeRouteCandidates(activeStaff.role),
      ]);

      if (fallbackRoute && navigateIfAllowed(fallbackRoute)) {
        return;
      }

      if (navigateIfAllowed(resolvedHomeRoute)) {
        return;
      } else {
        logoutStaff();
        showAccessDenied('This PIN has no valid page assigned. Use the correct staff PIN.');
      }
    }
  }, [activeStaff, findFirstAccessibleRoute, logoutStaff, navigateIfAllowed, showAccessDenied]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (pin.length === 6 && !isLoading) {
      handleSubmit();
    }
  }, [pin, isLoading]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Enter' && pin.length >= 4) {
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin]);

  return (
    <div className="h-screen w-screen flex items-center justify-center relative overflow-hidden bg-[#020617]">
      {/* Dynamic Background Image */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-40 scale-110 animate-slow-zoom"
        style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=2000")' }}
      />
      <div className="absolute inset-0 z-10 bg-gradient-to-br from-[#020617]/95 via-[#020617]/80 to-transparent" />

      {/* Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/10 rounded-full blur-[120px]" />

      <div className="relative z-20 w-full max-w-5xl px-4 flex flex-col md:flex-row items-center gap-12 md:gap-24">
        {/* Left Side: Branding */}
        <div className="hidden md:flex flex-col flex-1 space-y-8 animate-in fade-in slide-in-from-left duration-1000">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-primary rounded-[2rem] shadow-[0_0_40px_rgba(var(--primary),0.4)]">
              <ChefHat className="w-12 h-12 text-white" />
            </div>
            <div>
              <h1 className="text-5xl font-black tracking-tighter text-white uppercase italic leading-none">
                RESTAURANT <span className="text-primary block not-italic mt-1 drop-shadow-[0_0_15px_rgba(var(--primary),0.5)]">MANAGEMENT</span>
              </h1>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-4 group">
              <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-all">
                <Clock className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Shift Synchronization</h3>
                <p className="text-slate-400 text-sm">Real-time order tracking and staff performance.</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 group">
              <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-all">
                <Sparkles className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Premium Service</h3>
                <p className="text-slate-400 text-sm">Empowering waiters with intelligent POS tools.</p>
              </div>
            </div>

            <div className="flex items-center gap-4 group">
              <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-all">
                <ShieldCheck className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Secure Access</h3>
                <p className="text-slate-400 text-sm">Encrypted PIN verification for data integrity.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: PIN Pad */}
        <div className={cn(
          "w-full max-w-sm transition-all duration-500 animate-in zoom-in-95 slide-in-from-right-12",
          shake && "animate-shake"
        )}>
          <Card className="bg-white/5 backdrop-blur-2xl border-white/10 shadow-2xl overflow-hidden rounded-[2.5rem]">
            <CardHeader className="text-center pt-8 pb-4">
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-2xl w-fit border border-primary/20">
                <Lock className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <CardTitle className="text-3xl font-black text-white tracking-tight uppercase">Staff Portal</CardTitle>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.2em] mt-2">Enter Secure Identity PIN</p>
            </CardHeader>
            
            <CardContent className="space-y-8 px-8 pb-10">
              {/* PIN dots display */}
              <div className="flex justify-center gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-4 h-4 rounded-full border-2 transition-all duration-300",
                      i < pin.length
                        ? 'bg-primary border-primary scale-125 shadow-[0_0_15px_rgba(var(--primary),0.6)]'
                        : 'border-white/20'
                    )}
                  />
                ))}
              </div>

              {/* Number pad */}
              <div className="grid grid-cols-3 gap-4">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
                  <Button
                    key={digit}
                    variant="ghost"
                    className="h-16 text-2xl font-black text-white bg-white/5 hover:bg-primary hover:text-white rounded-2xl border border-white/5 transition-all active:scale-90"
                    onClick={() => handleDigit(digit)}
                    disabled={isLoading}
                  >
                    {digit}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  className="h-16 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-500 bg-white/5 rounded-2xl border border-white/5 transition-all"
                  onClick={handleClear}
                  disabled={isLoading}
                >
                  Clear
                </Button>
                <Button
                  key="0"
                  variant="ghost"
                  className="h-16 text-2xl font-black text-white bg-white/5 hover:bg-primary hover:text-white rounded-2xl border border-white/5 transition-all active:scale-90"
                  onClick={() => handleDigit('0')}
                  disabled={isLoading}
                >
                  0
                </Button>
                <Button
                  variant="ghost"
                  className="h-16 flex items-center justify-center text-slate-400 hover:text-white bg-white/5 rounded-2xl border border-white/5 transition-all active:scale-90"
                  onClick={handleDelete}
                  disabled={isLoading}
                >
                  <Delete className="h-6 w-6" />
                </Button>
              </div>

              {/* Submit button */}
              <div className="space-y-3">
                <Button
                  className="w-full h-16 text-lg font-black uppercase tracking-widest bg-primary hover:bg-primary/90 text-white rounded-2xl shadow-lg transition-all active:scale-95 overflow-hidden relative group border-none"
                  onClick={handleSubmit}
                  disabled={pin.length < 4 || isLoading}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                  {isLoading ? (
                    <div className="h-6 w-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <div className="flex items-center gap-3">
                      <LogIn className="h-5 w-5" />
                      <span>Initiate Session</span>
                    </div>
                  )}
                </Button>

                <Button 
                  variant="ghost" 
                  onClick={signOut}
                  className="w-full h-12 rounded-2xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 font-bold uppercase tracking-widest text-[10px] gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out of Account
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slow-zoom {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        .animate-slow-zoom {
          animation: slow-zoom 30s infinite linear;
        }
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        .group-hover\\:animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}} />
    </div>
  );
}
