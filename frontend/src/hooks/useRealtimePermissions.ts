import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, canUseRealtime, resetRealtimeReachable, setRealtimeUnreachable } from '@/integrations/supabase/client';
import { clearPermissionsCache } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';

/**
 * Hook that subscribes to real-time updates on role_permissions table.
 * When permissions change, it invalidates the cache and notifies the user.
 */
export function useRealtimePermissions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    // NOTE: Real-time websocket subscriptions not yet implemented on the
    // Node/Express backend. Using polling as a temporary fallback.
    if (!canUseRealtime()) {
      return;
    }

    const pollInterval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
    }, 30000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [queryClient, toast]);
}
