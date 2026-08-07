import { apiClient } from '../integrations/supabase/client';
export interface SyncQueueItem {
  id: string;
  table: string;
  action: 'insert' | 'update' | 'delete';
  data: any;
  timestamp: number;
  retry_count: number;
}
export async function getLocalData<T>(tableName: string): Promise<T[]> {
  // Directly fetch from online database
  const { data, error } = await apiClient.from(tableName).select('*');
  if (error) {
    console.error(`Error fetching ${tableName}:`, error);
    return [];
  }
  return (data || []) as T[];
}
export async function getLocalItem<T>(tableName: string, id: string): Promise<T | null> {
  const { data, error } = await apiClient.from(tableName).select('*').eq('id', id).single();
  if (error) {
    return null;
  }
  return data as T;
}
export async function saveLocalData<T>(tableName: string, data: T | T[]): Promise<void> {
  // No-op for local save since we are 100% online
}
export async function deleteLocalData(tableName: string, id: string): Promise<void> {
  // No-op
}
export async function clearLocalTable(tableName: string): Promise<void> {
  // No-op
}
export async function addToSyncQueue(item: SyncQueueItem): Promise<void> {
  // No-op
}
export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  return [];
}
export async function removeFromSyncQueue(id: string): Promise<void> {
  // No-op
}
