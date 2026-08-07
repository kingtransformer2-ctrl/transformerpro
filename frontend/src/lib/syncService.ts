import { apiClient } from '../integrations/supabase/client';

const HOTEL_TABLE_STATUSES = new Set(['free', 'reserved', 'occupied', 'cleaning']);

function sanitizeOperationData(table: string, action: 'insert' | 'update' | 'delete', data: any) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  );

  if (table === 'hotel_tables' && action !== 'delete' && 'status' in sanitized) {
    const normalizedStatus =
      typeof sanitized.status === 'string' ? sanitized.status.trim().toLowerCase() : sanitized.status;

    if (!normalizedStatus || !HOTEL_TABLE_STATUSES.has(String(normalizedStatus))) {
      sanitized.status = 'free';
    } else {
      sanitized.status = normalizedStatus as any;
    }
  }

  return sanitized;
}

export const syncService = {
  setSyncStatusCallback(callback: (status: 'idle' | 'syncing' | 'completed' | 'error') => void) {
    // No-op
  },

  async syncFromCloud(tableName: string, force = false) {
    try {
      if (!navigator.onLine) return null;
      
      const { data, error } = await apiClient
        .from(tableName)
        .select('*');

      if (error) {
        console.error(`[syncService] Error syncing ${tableName} from cloud:`, error);
        return null;
      }

      return data || null;
    } catch (err) {
      console.error(`[syncService] Failed to sync ${tableName} from cloud:`, err);
      return null;
    }
  },

  async processSyncQueue() {
    // No-op
  },

  performOperation(table: string, action: 'insert' | 'update' | 'delete', data: any) {
    let sanitizedData = sanitizeOperationData(table, action, data);

    // Extra defensive sanitization for hotel_tables: NEVER allow empty status
    if (table === 'hotel_tables' && action !== 'delete' && sanitizedData && typeof sanitizedData === 'object') {
      const statusVal = sanitizedData.status;
      if (!statusVal || !['free','reserved','occupied','cleaning'].includes(statusVal)) {
        sanitizedData.status = 'free';
      }
      // Ensure status is a clean string
      sanitizedData.status = String(sanitizedData.status).trim().toLowerCase();
    }

    const { id, ...rest } = sanitizedData || {};

    if (action === 'delete') {
      return apiClient.from(table).delete().eq('id', id).then(
        (result: any) => result,
        (error: any) => { throw new Error(error?.message || `Delete failed on ${table}`); }
      );
    } else if (action === 'update') {
      if (!id) {
        return Promise.reject(new Error(`Update on ${table} requires an id`));
      }

      // For hotel_tables, ensure rest has a valid status
      let updatePayload = rest;
      if (table === 'hotel_tables' && rest && typeof rest === 'object') {
        const statusVal = (rest as any).status;
        if (!statusVal || !['free','reserved','occupied','cleaning'].includes(statusVal)) {
          updatePayload = { ...rest, status: 'free' };
        } else {
          updatePayload = { ...rest, status: String(statusVal).trim().toLowerCase() };
        }
      }

      return apiClient.from(table).update(updatePayload).eq('id', id).then(
        (result: any) => result,
        (error: any) => { throw new Error(error?.message || `Update failed on ${table}`); }
      );
    } else {
      // insert
      return apiClient.from(table).insert(sanitizedData).then(
        (result: any) => result,
        (error: any) => { throw new Error(error?.message || `Insert failed on ${table}`); }
      );
    }
  },
};