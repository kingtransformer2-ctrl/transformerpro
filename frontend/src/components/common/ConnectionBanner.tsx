import { WifiOff } from 'lucide-react';
import { useSupabaseStatus } from '@/hooks/useSupabaseStatus';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function ConnectionBanner() {
  const { status } = useSupabaseStatus();
  const isOnline = navigator.onLine;

  if (status === 'connected' && isOnline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-md animate-in fade-in slide-in-from-bottom-4">
      <Alert variant="destructive" className="bg-rose-50/95 border-rose-200 shadow-2xl border-2 backdrop-blur">
        <WifiOff className="h-5 w-5 text-rose-600" />
        <AlertTitle className="font-black uppercase tracking-widest text-[10px] mb-1">
          Connection Lost
        </AlertTitle>
        <AlertDescription className="text-xs font-medium">
          Internet connection is offline. App requires internet to function properly.
        </AlertDescription>
      </Alert>
    </div>
  );
}
