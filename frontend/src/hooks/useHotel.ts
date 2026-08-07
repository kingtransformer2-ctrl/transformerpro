import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/supabase/client';
import { 
  HotelGuest, HotelInvoice, HotelInfo, HotelGuestFeedback, HotelPaymentRecord,
  HotelStaff, HotelBooking, HotelRoom
} from '@/types/hotel';
import { toast } from 'sonner';
import { useStaffSession } from '@/contexts/StaffSessionContext';
// Hotel Info
export function useHotelInfo() {
     return useQuery({
       queryKey: ['hotel-info'],
       queryFn: async () => {
         const { data, error } = await apiClient
           .from('hotel_info')
           .select('*')
           .limit(1)
           .maybeSingle();
         if (error) throw error;
         return data as HotelInfo | null;
       },
       staleTime: 1000 * 60 * 5, // 5 minutes instead of 1 hour
       refetchOnMount: 'always',
     });
   }
export function useUpdateHotelInfo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...info }: Partial<HotelInfo> & { id: string }) => {
      const { data, error } = await apiClient
        .from('hotel_info')
        .update(info)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-info'] });
    },
    onError: (error: Error) => toast.error(error.message)
  });
}

// Staff
export function useHotelStaff() {
  return useQuery({
    queryKey: ['hotel-staff'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_staff')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as HotelStaff[];
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (staff: Partial<Omit<HotelStaff, 'id' | 'created_at' | 'updated_at'>>) => {
      const { data, error } = await apiClient
        .from('hotel_staff')
        .insert([staff as any])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff'] });
      toast.success('Staff created successfully');
    },
    onError: (error: Error) => toast.error(error.message)
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...staff }: Partial<HotelStaff> & { id: string }) => {
      const { data, error } = await apiClient
        .from('hotel_staff')
        .update(staff)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff'] });
      toast.success('Staff updated successfully');
    },
    onError: (error: Error) => toast.error(error.message)
  });
}

export function useDeleteStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await apiClient
        .from('hotel_staff')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-staff'] });
      toast.success('Staff deactivated successfully');
    },
    onError: (error: Error) => toast.error(error.message)
  });
}

// Guests
export function useHotelGuests() {
  return useQuery({
    queryKey: ['hotel-guests'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_guests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as HotelGuest[];
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

export function useCreateGuest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (guest: { first_name: string; last_name: string; phone: string } & Partial<Omit<HotelGuest, 'id' | 'created_at' | 'updated_at'>>) => {
      const { data, error } = await apiClient
        .from('hotel_guests')
        .insert([guest as any])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-guests'] });
      toast.success('Guest created successfully');
    },
    onError: (error: Error) => toast.error(error.message)
  });
}

export function useUpdateGuest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...guest }: Partial<HotelGuest> & { id: string }) => {
      const { data, error } = await apiClient
        .from('hotel_guests')
        .update(guest)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-guests'] });
      toast.success('Guest updated successfully');
    },
    onError: (error: Error) => toast.error(error.message)
  });
}

// Rooms
export function useHotelRooms() {
  return useQuery({
    queryKey: ['hotel-rooms'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_rooms')
        .select('*')
        .order('room_number', { ascending: true });
      if (error) throw error;
      return data as HotelRoom[];
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

// Bookings
export function useHotelBookings() {
  return useQuery({
    queryKey: ['hotel-bookings'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_bookings')
        .select(`
          *,
          guest:hotel_guests(*),
          room:hotel_rooms(*)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as HotelBooking[];
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

// Dashboard
export function useHotelDashboard() {
  return useQuery({
    queryKey: ['hotel-dashboard'],
    queryFn: async () => {
      return {
        totalOrders: 0,
        totalRevenue: 0,
        totalGuests: 0,
        totalRooms: 0
      };
    }
  });
}

// Invoices
export function useHotelInvoices() {
  return useQuery({
    queryKey: ['hotel-invoices'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_invoices')
        .select(`
          *,
          guest:hotel_guests(id, first_name, last_name, email, phone)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error("Error fetching hotel invoices:", error);
        return [];
      }

      return (data || []) as HotelInvoice[];
    },
    staleTime: 1000 * 60 * 2,
  });
}

export function useHotelPayments() {
  return useQuery({
    queryKey: ['hotel-payments'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_payments')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching hotel payments:', error);
        return [];
      }

      return (data || []) as HotelPaymentRecord[];
    },
    staleTime: 1000 * 30,
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoice: Partial<HotelInvoice>) => {
      const { data, error } = await apiClient
        .from('hotel_invoices')
        .insert([{ ...invoice, invoice_number: '' }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotel-invoices'] });
      toast.success('Invoice created successfully');
    },
    onError: (error: Error) => toast.error(error.message)
  });
}

// Feedback
export function useHotelFeedback() {
  return useQuery({
    queryKey: ['hotel-feedback'],
    queryFn: async () => {
      const { data, error } = await apiClient
        .from('hotel_guest_feedback')
        .select(`
          *,
          guest:hotel_guests(*)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as HotelGuestFeedback[];
    }
  });
}
