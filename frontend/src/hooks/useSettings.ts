import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, safeApiClientCall } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { getLocalData, saveLocalData } from "@/lib/localDataService";
import { syncService } from "@/lib/syncService";

export interface Setting {
  id: string;
  category: string;
  key: string;
  value: any;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyProfile {
  id: string;
  company_name: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  tin_number?: string;
  logo_url?: string;
  business_hours?: Record<string, any>;
  tax_rates?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export function useSettings(category?: string) {
  return useQuery({
    queryKey: ["settings", category],
    queryFn: async () => {
      // 1. Try local data first
      const cached = await getLocalData<Setting>("settings");
      const filtered = category ? cached.filter(s => s.category === category) : cached;
      
      // 2. Trigger background sync (non-blocking)
      syncService.syncFromCloud("settings").catch(() => {});
      
      return filtered.sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key));
    },
    initialData: [],
    staleTime: 1000 * 60 * 5,
  });
}

export function useCompanyProfile() {
  return useQuery({
    queryKey: ["company_profile"],
    queryFn: async () => {
      // 1. Try local data first
      const cached = await getLocalData<CompanyProfile>("company_profile");
      
      // 2. Trigger background sync
      syncService.syncFromCloud("company_profile").catch(() => {});
      
      return cached[0] || null;
    },
    staleTime: 1000 * 60 * 30,
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ category, key, value }: { category: string; key: string; value: any }) => {
      const id = `${category}_${key}`;
      const now = new Date().toISOString();
      const newSetting = { id, category, key, value, updated_at: now, created_at: now };

      // 1. Unified Operation
      await syncService.performOperation("settings", "update", newSetting);

      return newSetting;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast({
        title: "Setting updated",
        description: "Setting saved locally and syncing...",
      });
    },
  });
}

export function useUpdateCompanyProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: Partial<CompanyProfile>) => {
      const id = profile.id || crypto.randomUUID();
      const now = new Date().toISOString();
      const newProfile = { ...profile, id, updated_at: now, created_at: now };

      // 1. Unified Operation (Local-First + Sync Queue)
      await syncService.performOperation("company_profile", "update", newProfile);

      return newProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company_profile"] });
      toast({
        title: "Company profile updated",
        description: "Company profile saved locally and syncing...",
      });
    },
    onError: (error) => {
      console.error("Error updating company profile:", error);
      toast({
        title: "Error",
        description: "Failed to update company profile. Please try again.",
        variant: "destructive",
      });
    },
  });
}

export function useDeleteCompanyProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // 1. Unified Operation
      await syncService.performOperation("company_profile", "delete", { id });
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company_profile"] });
      toast({
        title: "Profile Deleted",
        description: "System information has been reset locally.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete profile",
        variant: "destructive",
      });
    },
  });
}

export interface UserRoleWithProfile {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  updated_at: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export function useUserRoles() {
  return useQuery({
    queryKey: ["user_roles"],
    queryFn: async () => {
      // 1. Try local data first
      const cached = await getLocalData<UserRoleWithProfile>("user_roles");
      
      // 2. Trigger background sync
      syncService.syncFromCloud("user_roles").catch(() => {});
      
      return cached;
    },
    initialData: [],
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ user_id, role, reason }: { user_id: string; role: string; reason?: string }) => {
      // Use the secure RPC function that validates against role_permissions table
      const { data, error } = await apiClient.rpc("safe_update_user_role", {
        target_user_id: user_id,
        new_role: role,
        reason: reason || "Role updated via admin interface",
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      syncService.syncFromCloud("user_roles").catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["user_roles"] });
      toast({
        title: "User role saved",
        description: "User role access has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      console.error("Error updating user role:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update user role. Please try again.",
        variant: "destructive",
      });
    },
  });
}

export function useRemoveUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ user_id, role, reason }: { user_id: string; role: string; reason?: string }) => {
      const { data, error } = await apiClient.rpc("safe_remove_user_role" as any, {
        target_user_id: user_id,
        target_role: role,
        reason: reason || "Role removed via admin interface",
      } as any);

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      syncService.syncFromCloud("user_roles").catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["user_roles"] });
      toast({
        title: "User role removed",
        description: "The selected role has been removed successfully.",
      });
    },
    onError: (error: Error) => {
      console.error("Error removing user role:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to remove user role. Please try again.",
        variant: "destructive",
      });
    },
  });
}
