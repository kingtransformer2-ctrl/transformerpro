import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ServiceMenuItem } from './useServiceMenu';

export interface OrderTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  icon: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  items?: OrderTemplateItem[];
}

export interface OrderTemplateItem {
  id: string;
  template_id: string;
  service_item_id: string;
  quantity: number;
  created_at: string;
  service_item?: ServiceMenuItem;
}

export function useOrderTemplates() {
  return useQuery({
    queryKey: ['order-templates'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_order_templates')
        .select(`
          *,
          items:hotel_order_template_items(
            *,
            service_item:hotel_service_menu(*)
          )
        `)
        .eq('is_active', true)
        .order('sort_order');
      
      if (error) throw error;
      return data as OrderTemplate[];
    },
  });
}

export function useAllOrderTemplates() {
  return useQuery({
    queryKey: ['order-templates', 'all'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_order_templates')
        .select(`
          *,
          items:hotel_order_template_items(
            *,
            service_item:hotel_service_menu(*)
          )
        `)
        .order('sort_order');
      
      if (error) throw error;
      return data as OrderTemplate[];
    },
  });
}

export function useCreateOrderTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (template: {
      name: string;
      description?: string;
      category?: string;
      icon?: string;
      items: { service_item_id: string; quantity: number }[];
    }) => {
      const { items, ...templateData } = template;

      // Create template
      const { data: newTemplate, error: templateError } = await apiClient
        .from('hotel_order_templates')
        .insert([templateData])
        .select()
        .single();

      if (templateError) throw templateError;

      // Add items
      if (items.length > 0) {
        const templateItems = items.map(item => ({
          template_id: newTemplate.id,
          service_item_id: item.service_item_id,
          quantity: item.quantity,
        }));

        const { error: itemsError } = await apiClient
          .from('hotel_order_template_items')
          .insert(templateItems);

        if (itemsError) throw itemsError;
      }

      return newTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-templates'] });
      toast.success('Template created');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateOrderTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      items,
      ...updates
    }: {
      id: string;
      name?: string;
      description?: string;
      category?: string;
      icon?: string;
      is_active?: boolean;
      items?: { service_item_id: string; quantity: number }[];
    }) => {
      // Update template
      const { error: templateError } = await apiClient
        .from('hotel_order_templates')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (templateError) throw templateError;

      // Update items if provided
      if (items !== undefined) {
        // Delete existing items
        await apiClient
          .from('hotel_order_template_items')
          .delete()
          .eq('template_id', id);

        // Insert new items
        if (items.length > 0) {
          const templateItems = items.map(item => ({
            template_id: id,
            service_item_id: item.service_item_id,
            quantity: item.quantity,
          }));

          const { error: itemsError } = await apiClient
            .from('hotel_order_template_items')
            .insert(templateItems);

          if (itemsError) throw itemsError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-templates'] });
      toast.success('Template updated');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteOrderTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient
        .from('hotel_order_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-templates'] });
      toast.success('Template deleted');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
