import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ServiceCategory {
  id: string;
  name: string;
  label: string;
  icon: string;
  image_url: string | null;
  station: 'kitchen' | 'bar' | 'other';
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ServiceCategoryInsert = Pick<ServiceCategory, 'name' | 'label' | 'icon' | 'image_url' | 'station' | 'sort_order'>;
export type ServiceCategoryUpdate = Partial<ServiceCategoryInsert> & { is_active?: boolean };

export function useServiceCategories() {
  return useQuery({
    queryKey: ['service-categories'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_service_categories')
        .select('*')
        .order('sort_order');
      
      if (error) throw error;
      return data as ServiceCategory[];
    },
  });
}

export function useActiveServiceCategories() {
  return useQuery({
    queryKey: ['service-categories', 'active'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_service_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      
      if (error) throw error;
      return data as ServiceCategory[];
    },
  });
}

export function useAddServiceCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (category: ServiceCategoryInsert) => {
      const { data, error } = await apiClient
        .from('hotel_service_categories')
        .insert([{ ...category, is_system: false }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-categories'] });
      toast.success('Category added');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateServiceCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ServiceCategoryUpdate }) => {
      const { data, error } = await apiClient
        .from('hotel_service_categories')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-categories'] });
      toast.success('Category updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteServiceCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient
        .from('hotel_service_categories')
        .delete()
        .eq('id', id)
        .eq('is_system', false); // Prevent deleting system categories

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-categories'] });
      toast.success('Category deleted');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useToggleCategoryActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await apiClient
        .from('hotel_service_categories')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-categories'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
