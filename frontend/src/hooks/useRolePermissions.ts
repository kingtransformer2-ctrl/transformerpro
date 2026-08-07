import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { clearPermissionsCache, setCachedPermissions } from "@/lib/permissions";

import { getLocalData, saveLocalData } from "@/lib/localDataService";
import { syncService } from "@/lib/syncService";

export interface RolePermission {
  id: string;
  role: string;
  pos_routes: string[];
  hotel_routes: string[];
  landing_page?: string | null;
  description: string | null;
  is_system: boolean | null;
  color: string | null;
  icon: string | null;
  created_at: string;
  updated_at: string;
}

function sortRolePermissions(permissions: RolePermission[] | null | undefined) {
  return [...(permissions || [])].sort((a, b) => a.role.localeCompare(b.role));
}

async function loadRolePermissions(forceSync = false) {
  const cached = sortRolePermissions(await getLocalData<RolePermission>('role_permissions'));

  try {
    const freshData = await syncService.syncFromCloud('role_permissions', forceSync);
    if (freshData) {
      const sortedFresh = sortRolePermissions(freshData as RolePermission[]);
      await saveLocalData('role_permissions', sortedFresh);
      return sortedFresh;
    }
  } catch {
    // Fall back to the last synced local snapshot.
  }

  return cached;
}

// Available routes for POS mode
export const availablePosRoutes = [
  { path: '/', label: 'Dashboard', description: 'Main dashboard view' },
  { path: '/owner', label: 'Owner Dashboard', description: 'Business owner analytics' },
  { path: '/settings', label: 'Settings', description: 'System configuration' },
  { path: '/reports', label: 'Reports', description: 'Sales and analytics reports' },
  { path: '/stock', label: 'Stock Management', description: 'Inventory control' },
  { path: '/products', label: 'Products', description: 'Product catalog management' },
  { path: '/loans', label: 'Loans', description: 'Customer loan management' },
  { path: '/pos', label: 'Point of Sale', description: 'Sales terminal' },
  { path: '/sales', label: 'Sales History', description: 'View past transactions' },
  { path: '/customers', label: 'Customers', description: 'Customer management' },
  { path: '/scanner', label: 'Scanner', description: 'Barcode scanning' },
  { path: '/notifications', label: 'Notifications', description: 'System alerts' },
];

// Available routes for Restaurant mode (exact list from user specs)
export const availableHotelRoutes = [
  { path: '/restaurant/dashboard', label: 'Dashboard', description: 'Restaurant overview' },
  { path: '/restaurant/pos', label: 'Point of Sale', description: 'Point of Sale' },
  { path: '/restaurant/waiter-pos', label: 'Waiter POS', description: 'Waiter point of sale' },
  { path: '/restaurant/tables', label: 'Tables', description: 'Tables' },
  { path: '/restaurant/menu', label: 'Menu', description: 'Menu' },
  { path: '/restaurant/inventory', label: 'Inventory', description: 'Restaurant inventory' },
  { path: '/restaurant/kitchen', label: 'Kitchen', description: 'Kitchen' },
  { path: '/restaurant/bar', label: 'Bar', description: 'Bar' },
  { path: '/restaurant/billing', label: 'Billing', description: 'Billing' },
  { path: '/restaurant/staff', label: 'Staff', description: 'Staff' },
  { path: '/restaurant/attendance', label: 'Attendance', description: 'Attendance' },
  { path: '/restaurant/shifts', label: 'Shifts', description: 'Shifts' },
  { path: '/restaurant/shift-report', label: 'Shift Report', description: 'Shift Report' },
  { path: '/restaurant/finance', label: 'Finance', description: 'Finance' },
  { path: '/restaurant/reports', label: 'Reports', description: 'Reports' },
  { path: '/restaurant/settings', label: 'Settings', description: 'Settings' },
  { path: '/restaurant/customers', label: 'Customers', description: 'Customers' },
  { path: '/restaurant/products', label: 'Products', description: 'Products' },
  { path: '/restaurant/stock', label: 'Stock', description: 'Stock' },
  { path: '/restaurant/sales', label: 'Sales', description: 'Sales' },
  { path: '/restaurant/loans', label: 'Loans', description: 'Loans' },
];

export function useRolePermissions() {
  return useQuery({
    queryKey: ['role-permissions'],
    queryFn: () => loadRolePermissions(true),
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}

export function useRolePermissionByRole(role: string | null) {
  return useQuery({
    queryKey: ['role-permissions', role],
    queryFn: async () => {
      if (!role) return null;

      const cached = await loadRolePermissions(true);
      const filtered = cached.find(p => p.role === role);

      return filtered || null;
    },
    enabled: !!role,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}

export function useUpdateRolePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (permission: Partial<RolePermission> & { role: string }) => {
      // First update the role_permissions table
      const result = await (apiClient
        .from('role_permissions')
        .update({
          pos_routes: permission.pos_routes,
          hotel_routes: permission.hotel_routes,
          description: permission.description,
          color: permission.color,
          icon: permission.icon,
          landing_page: permission.landing_page,
          updated_at: new Date().toISOString(),
        })
        .eq('role', permission.role)
        .select()
        .single() as any);
      
      if (result.error) throw new Error(result.error.message || 'Failed to update permissions');
      const data = result.data;

      // Then update all staff members with this role
      const staffResult = await (apiClient
        .from('hotel_staff')
        .update({ allowed_hotel_routes: permission.hotel_routes })
        .eq('role', permission.role) as any);

      if (staffResult.error) throw new Error(staffResult.error.message || 'Failed to update staff');

      return data;
    },
    onSuccess: async (updatedPermission) => {
      // Clear permissions cache so changes take effect immediately
      clearPermissionsCache();

      const nextPermissions = await queryClient.fetchQuery({
        queryKey: ['role-permissions'],
        queryFn: async () => {
          const current = sortRolePermissions(await getLocalData<RolePermission>('role_permissions'));
          const merged = sortRolePermissions(
            current.some((permission) => permission.role === updatedPermission.role)
              ? current.map((permission) =>
                  permission.role === updatedPermission.role ? { ...permission, ...updatedPermission } : permission
                )
              : [...current, updatedPermission as RolePermission]
          );
          await saveLocalData('role_permissions', merged);
          return merged;
        },
      });
      setCachedPermissions(nextPermissions);
      queryClient.setQueryData(['role-permissions'], nextPermissions);
      queryClient.setQueryData(
        ['role-permissions', updatedPermission.role],
        updatedPermission as RolePermission
      );
      queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
      toast.success("Permissions Updated", {
        description: "Role permissions have been saved successfully and staff access updated.",
      });
    },
    onError: (error) => {
      toast.error("Error", {
        description: "Failed to update permissions: " + error.message,
      });
    },
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      description?: string;
      color?: string;
      icon?: string;
      pos_routes?: string[];
      hotel_routes?: string[];
    }) => {
      const result = await (apiClient
        .from('role_permissions')
        .insert({
          role: params.name,
          description: params.description || null,
          color: params.color || 'default',
          icon: params.icon || 'Shield',
          pos_routes: params.pos_routes || [],
          hotel_routes: params.hotel_routes || [],
          is_system: false,
        })
        .select()
        .single() as any);
      
      if (result.error) throw new Error(result.error.message || 'Failed to create role');
      return result.data;
    },
    onSuccess: async (data) => {
      clearPermissionsCache();

      const nextPermissions = await loadRolePermissions(true);
      setCachedPermissions(nextPermissions);
      queryClient.setQueryData(['role-permissions'], nextPermissions);
      queryClient.setQueryData(
        ['role-permissions', data.role],
        data
      );
      queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
      toast.success("Role Created", {
        description: "Custom role has been created successfully.",
      });
    },
    onError: (error) => {
      toast.error("Error", {
        description: "Failed to create role: " + error.message,
      });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (roleName: string) => {
      const result = await (apiClient
        .from('role_permissions')
        .delete()
        .eq('role', roleName)
        .eq('is_system', false)
        .select()
        .maybeSingle() as any);
      
      if (result.error) throw new Error(result.error.message || 'Failed to delete role');
      return result.data;
    },
    onSuccess: async (_, roleName) => {
      // Clear permissions cache so deleted role is removed
      clearPermissionsCache();

      const nextPermissions = sortRolePermissions(
        (await getLocalData<RolePermission>('role_permissions')).filter(
          (permission) => permission.role !== roleName
        )
      );
      await saveLocalData('role_permissions', nextPermissions);
      setCachedPermissions(nextPermissions);
      queryClient.setQueryData(['role-permissions'], nextPermissions);
      queryClient.removeQueries({ queryKey: ['role-permissions', roleName], exact: true });
      queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
      toast.success("Role Deleted", {
        description: "Custom role has been deleted successfully.",
      });
    },
    onError: (error) => {
      toast.error("Error", {
        description: "Failed to delete role: " + error.message,
      });
    },
  });
}
