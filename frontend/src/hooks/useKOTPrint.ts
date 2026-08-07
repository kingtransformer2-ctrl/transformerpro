import { useState, useCallback, useMemo } from 'react';
import type { KOTData } from '@/components/hotel/KOTPrint';

function kotSignature(job: KOTData): string {
  return [
    job.station,
    job.orderNumber,
    job.type || 'new',
    job.timestamp.getTime(),
    job.items.map(i => `${i.name}|${i.quantity}|${i.notes || ''}`).join(';'),
  ].join('||');
}

export function useKOTPrint() {
  const [kotQueue, setKotQueue] = useState<KOTData[]>([]);

  const currentKOT = useMemo(() => kotQueue[0] ?? null, [kotQueue]);

  const handlePrintComplete = useCallback(() => {
    setKotQueue((prevQueue) => prevQueue.slice(1));
  }, []);

  const enqueueUnique = useCallback((job: KOTData) => {
    setKotQueue((prevQueue) => {
      const sig = kotSignature(job);
      const existing = prevQueue.some(j => kotSignature(j) === sig);
      if (existing) return prevQueue;
      return [...prevQueue, job];
    });
  }, []);

  const printKitchenOrder = useCallback((params: {
    orderNumber: string;
    tableNumber?: string;
    roomNumber?: string | null;
    waiterName?: string;
    items: Array<{ name: string; quantity: number; notes?: string | null }>;
    orderNotes?: string;
    type?: 'new' | 'updated' | 'cancelled';
    cancelReason?: string;
    timestamp?: Date;
  }) => {
    if (!params.items.length) return;
    enqueueUnique({
      orderNumber: params.orderNumber,
      station: 'kitchen',
      type: params.type || 'new',
      tableNumber: params.tableNumber,
      roomNumber: params.roomNumber || null,
      waiterName: params.waiterName,
      items: params.items,
      orderNotes: params.orderNotes,
      cancelReason: params.cancelReason,
      timestamp: params.timestamp || new Date(),
    });
  }, [enqueueUnique]);

  const printBarOrder = useCallback((params: {
    orderNumber: string;
    tableNumber?: string;
    roomNumber?: string | null;
    waiterName?: string;
    items: Array<{ name: string; quantity: number; notes?: string | null }>;
    orderNotes?: string;
    type?: 'new' | 'updated' | 'cancelled';
    cancelReason?: string;
    timestamp?: Date;
  }) => {
    if (!params.items.length) return;
    enqueueUnique({
      orderNumber: params.orderNumber,
      station: 'bar',
      type: params.type || 'new',
      tableNumber: params.tableNumber,
      roomNumber: params.roomNumber || null,
      waiterName: params.waiterName,
      items: params.items,
      orderNotes: params.orderNotes,
      cancelReason: params.cancelReason,
      timestamp: params.timestamp || new Date(),
    });
  }, [enqueueUnique]);

  return {
    currentKOT,
    handlePrintComplete,
    printKitchenOrder,
    printBarOrder,
    kotQueue,
    setKotQueue,
  };
}
