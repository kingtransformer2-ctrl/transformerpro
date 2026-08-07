import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { availableHotelRoutes } from '@/hooks/useRolePermissions';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { HotelStaff } from '@/types/hotel';

interface StaffPinSetupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string;
  staffName: string;
  role?: string | null;
  currentPin?: string | null;
  currentRoutes?: string[];
}

export function StaffPinSetup({ open, onOpenChange, staffId, staffName, role, currentPin, currentRoutes = [] }: StaffPinSetupProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>(currentRoutes);
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();
  const { data: rolePermissions } = useRolePermissions();
  
  // Get allowed routes from this staff's role
  const roleAllowedRoutes = rolePermissions?.find(p => p.role === role)?.hotel_routes || [];
  
  useEffect(() => {
    if (open) {
      // When dialog opens, set selected routes to staff's current allowed routes
      setSelectedRoutes(currentRoutes);
    }
  }, [currentRoutes, open]);

  const handleRouteToggle = (path: string) => {
    // Only allow toggling routes that are in the role's allowed routes
    if (!roleAllowedRoutes.includes(path)) return;
    
    setSelectedRoutes(prev =>
      prev.includes(path)
        ? prev.filter(r => r !== path)
        : [...prev, path]
    );
  };

  const handleSelectAll = () => {
    if (selectedRoutes.length === roleAllowedRoutes.length) {
      setSelectedRoutes([]);
    } else {
      setSelectedRoutes([...roleAllowedRoutes]);
    }
  };

  const handleSave = async () => {
    // Validate PIN if provided
    if (pin) {
      if (pin.length < 4 || pin.length > 6) {
        toast.error('PIN must be 4-6 digits');
        return;
      }
      if (!/^\d+$/.test(pin)) {
        toast.error('PIN must contain only numbers');
        return;
      }
      if (pin !== confirmPin) {
        toast.error('PINs do not match');
        return;
      }
    }

    setIsLoading(true);
    try {
      const updateData: any = {
        allowed_hotel_routes: selectedRoutes,
      };
      if (pin) {
        updateData.pin = pin;
      }

      const { error } = await apiClient
        .from('hotel_staff')
        .update(updateData)
        .eq('id', staffId);

      if (error) throw error;

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['hotel-staff'] });
      toast.success('Staff access updated successfully!');
      onOpenChange(false);
      setPin('');
      setConfirmPin('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            PIN & Access — {staffName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* PIN Setup */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Login PIN</h3>
            <p className="text-xs text-muted-foreground">
              {currentPin ? 'Update the PIN or leave blank to keep current' : 'Set a 4-6 digit PIN for quick login'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">New PIN</Label>
                <div className="relative">
                  <Input
                    type={showPin ? 'text' : 'password'}
                    placeholder="••••"
                    maxLength={6}
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPin(!showPin)}
                  >
                    {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Confirm PIN</Label>
                <Input
                  type={showPin ? 'text' : 'password'}
                  placeholder="••••"
                  maxLength={6}
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
          </div>

          {/* Route Permissions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Page Access</h3>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={handleSelectAll}>
                {selectedRoutes.length === roleAllowedRoutes.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Configure which pages this staff member can access (based on their role).
            </p>
            <div className="space-y-2 max-h-52 overflow-y-auto border rounded-md p-3">
              {roleAllowedRoutes.map(path => {
                const routeInfo = availableHotelRoutes.find(r => r.path === path);
                if (!routeInfo) return null;
                
                return (
                  <label
                    key={path}
                    className="flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={selectedRoutes.includes(path)}
                      onCheckedChange={() => handleRouteToggle(path)}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{routeInfo.label}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <Button onClick={handleSave} className="w-full" disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Save Access Settings'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
