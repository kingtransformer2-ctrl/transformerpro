import { Button } from '@/components/ui/button';
import { useAppMode } from '@/contexts/AppModeContext';
import { Building2, ShoppingCart, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useRolePermissionByRole } from '@/hooks/useRolePermissions';
import { useNavigate } from 'react-router-dom';

export function ModeSwitcher() {
  const { mode, setMode } = useAppMode();
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const { data: permissions } = useRolePermissionByRole(userRole);

  const hasPOSAccess = permissions?.pos_routes && permissions.pos_routes.length > 0;
  const hasHotelAccess = permissions?.hotel_routes && permissions.hotel_routes.length > 0;

  // If the user has access to both, show a button to go back to selection
  const showSwitchOption = hasPOSAccess && hasHotelAccess;

  if (!showSwitchOption) return null;

  return (
    <div className="flex flex-col gap-2 w-full">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setMode(null);
          navigate('/mode-selection');
        }}
        className="w-full gap-2 border-primary/20 hover:bg-primary/5 text-primary font-bold text-[10px] uppercase tracking-widest h-9"
      >
        <LayoutGrid className="h-3 w-3" />
        Switch Module
      </Button>
    </div>
  );
}
