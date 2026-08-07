import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/ui/use-toast";
import { apiClient } from "@/integrations/supabase/client";

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  tin_number?: string;
  created_at: string;
  updated_at: string;
}

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadInitialData = useCallback(async () => {
    try {
      const cached = await apiClient.from('customers').select('*').then(res => res.data || []);
      if (cached.length > 0) {
        setCustomers(cached);
        setLoading(false);
      }
      
      const freshData = await Promise.resolve(null);
      if (freshData) {
        setCustomers(freshData as Customer[]);
      }
    } catch (error) {
      console.warn("Fast load failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const findOrCreateCustomer = async (name: string, phone?: string, additionalData?: Partial<Omit<Customer, 'id' | 'name' | 'phone' | 'created_at' | 'updated_at'>>) => {
    const existing = customers.find(c => (phone && c.phone === phone) || c.name === name);
    if (existing) return existing;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newCustomer = { 
      id, 
      name, 
      phone, 
      ...additionalData,
      created_at: now, 
      updated_at: now 
    };

    // 1. Unified Operation
    await apiClient.from('customers').insert(newCustomer);

    // 2. Update local state
    setCustomers(prev => [newCustomer, ...prev]);

    return newCustomer;
  };

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const addCustomer = async (data: Omit<Customer, 'id' | 'created_at' | 'updated_at'>) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newCustomer = { id, ...data, created_at: now, updated_at: now };
    await apiClient.from('customers').insert(newCustomer);
    setCustomers(prev => [newCustomer, ...prev]);
    return newCustomer;
  };

  const updateCustomer = async (id: string, data: Partial<Customer>) => {
    await apiClient.from('customers').update({ id, ...data }).eq('id', { id, ...data }.id || { id, ...data }?.id);
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
  };

  const deleteCustomer = async (id: string) => {
    await apiClient.from('customers').delete().eq('id', { id }.id || { id }?.id);
    setCustomers(prev => prev.filter(c => c.id !== id));
  };

  const bulkUpdateCustomers = async (ids: string[], data: Partial<Customer>) => {
    for (const id of ids) {
      await apiClient.from('customers').update({ id, ...data }).eq('id', { id, ...data }.id || { id, ...data }?.id);
    }
    setCustomers(prev => prev.map(c => ids.includes(c.id) ? { ...c, ...data } : c));
  };

  const bulkDeleteCustomers = async (ids: string[]) => {
    for (const id of ids) {
      await apiClient.from('customers').delete().eq('id', { id }.id || { id }?.id);
    }
    setCustomers(prev => prev.filter(c => !ids.includes(c.id)));
  };

  return {
    customers,
    loading,
    findOrCreateCustomer,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    bulkUpdateCustomers,
    bulkDeleteCustomers,
    refreshCustomers: loadInitialData,
  };
}
