import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAppMode } from '@/contexts/AppModeContext';
import { useRolePermissionByRole } from '@/hooks/useRolePermissions';
import { isAdminRole } from '@/lib/permissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, ShoppingCart, Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';

export default function ModeSelection() {
  const { user, userRole, signOut } = useAuth();
  const { setMode } = useAppMode();
  const navigate = useNavigate();
  const { data: permissions, isLoading } = useRolePermissionByRole(userRole);

  const hasPOSAccess = false; // Disable POS access
  const hasHotelAccess = isAdminRole(userRole, permissions ? [permissions] : null) || Boolean(permissions?.hotel_routes?.length);

  useEffect(() => {
    if (!isLoading) {
      // If only hotel mode is available (POS disabled), select it automatically
      if (!hasPOSAccess && hasHotelAccess) {
        handleSelectMode('hotel');
      } else if (!hasPOSAccess && !hasHotelAccess) {
        toast.error("You don't have access to any modules. Please contact admin.");
      }
    }
  }, [isLoading, hasPOSAccess, hasHotelAccess]);

  const handleSelectMode = (mode: 'pos' | 'hotel') => {
    setMode(mode);
    if (mode === 'pos') {
      navigate('/');
    } else {
      navigate('/hotel');
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black tracking-tight text-slate-900">SELECT MODULE</h1>
          <p className="text-slate-500 font-medium uppercase tracking-widest text-sm">
            Welcome back, {user?.email}. Please choose your workspace.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Restaurant Card */}
          <Card
            className={`group relative overflow-hidden border-2 transition-all duration-500 cursor-pointer hover:shadow-2xl hover:-translate-y-1 ${
              hasHotelAccess ? 'border-slate-100 hover:border-indigo-600' : 'opacity-50 cursor-not-allowed grayscale'
            }`}
            onClick={() => hasHotelAccess && handleSelectMode('hotel')}
          >
            <CardHeader className="relative z-10 p-8">
              <div className={`h-16 w-16 rounded-2xl flex items-center justify-center mb-6 transition-colors duration-500 ${
                hasHotelAccess ? 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white' : 'bg-slate-100 text-slate-400'
              }`}>
                <Building2 className="h-8 w-8" />
              </div>
              <CardTitle className="text-2xl font-black tracking-tight">RESTAURANT MANAGEMENT</CardTitle>
              <CardDescription className="text-slate-500 font-medium uppercase tracking-widest text-xs mt-2">
                Bookings, Tables, Orders & Guest Services
              </CardDescription>
            </CardHeader>
            {!hasHotelAccess && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[1px] z-20">
                <span className="bg-slate-900 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Access Restricted</span>
              </div>
            )}
          </Card>
        </div>

        <div className="flex justify-center pt-4">
          <Button 
            variant="ghost" 
            onClick={() => signOut()}
            className="text-slate-400 hover:text-rose-600 font-bold uppercase tracking-widest text-[10px] gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
