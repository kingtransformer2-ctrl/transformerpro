import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  canUseRealtime,
  canUseApiClientSync,
  apiClient,
} from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  ACTIVE_STAFF_UPDATED_EVENT,
  clearWaiterPosAccess,
  clearHotelIsolationCache,
  getStoredActiveStaff,
  isManagerLikeStaff,
  normalizeStaffAllowedRoutes,
  normalizeStoredActiveStaff,
  persistActiveStaff,
} from '@/lib/hotelAccess';
import { HotelStaffAttendance, HotelStaffShift } from '@/types/hotel';

export interface ActiveStaff {
  staff_id: string;
  first_name: string;
  last_name: string;
  role: string;
  allowed_hotel_routes: string[];
}

type PinVerificationOptions = {
  expectedStaffId?: string | null;
  waiterOnly?: boolean;
};

type PinVerificationResult = {
  success: boolean;
  error?: string;
  staff?: ActiveStaff;
  activeAttendance?: HotelStaffAttendance | null;
  activeShift?: HotelStaffShift | null;
};

interface StaffSessionContextType {
  activeStaff: ActiveStaff | null;
  activeAttendance: HotelStaffAttendance | null;
  activeShift: HotelStaffShift | null;
  isStaffLoggedIn: boolean;
  isAttendanceApproved: boolean;
  isShiftActive: boolean;
  isBootstrapping: boolean;
  verifyPinOnly: (pin: string, options?: PinVerificationOptions) => Promise<PinVerificationResult>;
  loginWithPin: (
    pin: string,
    options?: { verification?: PinVerificationResult; verifyOptions?: PinVerificationOptions }
  ) => Promise<{ success: boolean; error?: string; staff?: ActiveStaff }>;
  logoutStaff: () => void;
  resetTimeout: () => void;
  refreshActiveShift: () => Promise<void>;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const defaultStaffSessionContext: StaffSessionContextType = {
  activeStaff: null,
  activeAttendance: null,
  activeShift: null,
  isStaffLoggedIn: false,
  isAttendanceApproved: false,
  isShiftActive: false,
  isBootstrapping: true,
  verifyPinOnly: async () => ({ success: false, error: 'Staff session is not ready yet' }),
  loginWithPin: async () => ({ success: false, error: 'Staff session is not ready yet' }),
  logoutStaff: () => {},
  resetTimeout: () => {},
  refreshActiveShift: async () => {},
};

const StaffSessionContext = createContext<StaffSessionContextType>(defaultStaffSessionContext);

function buildActiveStaffFromPinResult(result: any): ActiveStaff {
  return normalizeStoredActiveStaff({
    staff_id: result.staff_id,
    first_name: result.first_name,
    last_name: result.last_name,
    role: result.role,
    allowed_hotel_routes: normalizeStaffAllowedRoutes(result.role, result.allowed_hotel_routes),
  })!;
}

function isMissingWaiterPinRpcError(error: { message?: string; details?: string; code?: string; status?: number } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(' ').toLowerCase();
  return (
    error?.status === 404 ||
    text.includes('verify_waiter_pos_pin') ||
    text.includes('could not find the function') ||
    text.includes('schema cache')
  );
}

export function StaffSessionProvider({ children }: { children: React.ReactNode }) {
  const [activeStaff, setActiveStaff] = useState<ActiveStaff | null>(null);
  const [activeAttendance, setActiveAttendance] = useState<HotelStaffAttendance | null>(null);
  const [activeShift, setActiveShift] = useState<HotelStaffShift | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const refreshActiveShift = useCallback(async () => {
    // No-op now, since shift is always active
  }, []);

  async function applyStaffSession(
    nextStaff: ActiveStaff | null,
    preload?: {
      activeAttendance?: HotelStaffAttendance | null;
      activeShift?: HotelStaffShift | null;
    }
  ) {
    const previousStaff = getStoredActiveStaff();
    const staffChanged = previousStaff?.staff_id !== nextStaff?.staff_id;

    if (staffChanged) {
      clearWaiterPosAccess();
      await clearHotelIsolationCache();
    }

    if (nextStaff?.staff_id) {
      persistActiveStaff(nextStaff);
      setActiveStaff(nextStaff);
      setActiveAttendance(preload?.activeAttendance || null);
      setActiveShift(preload?.activeShift || null);
    } else {
      clearWaiterPosAccess();
      persistActiveStaff(null);
      setActiveStaff(null);
      setActiveAttendance(null);
      setActiveShift(null);
    }
  }

  const logoutStaff = useCallback(() => {
    void (async () => {
      const hadStaff = !!activeStaff;
      
      sessionStorage.removeItem("waiterTableEntry");
      sessionStorage.removeItem("hotel.waiterPosAccess");
      sessionStorage.removeItem("hotel.posAccessGranted");
      
      await applyStaffSession(null);
      
      if (hadStaff) {
        toast.info('Staff session signed out');
      }
    })();
  }, [activeStaff, applyStaffSession]);

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (activeStaff) {
      timeoutRef.current = setTimeout(() => {
        logoutStaff();
      }, SESSION_TIMEOUT_MS);
    }
  }, [activeStaff, logoutStaff]);

  useEffect(() => {
    // Bootstrap immediately without waiting for anything!
    const bootstrapStaffSession = async () => {
      const storedStaff = getStoredActiveStaff();
      
      if (storedStaff) {
        // Re-verify stored staff exists and is active in DB
        try {
          const { data: staffFromDb } = await apiClient
            .from('hotel_staff')
            .select('id, first_name, last_name, role, is_active, allowed_hotel_routes')
            .eq('id', storedStaff.staff_id)
            .maybeSingle();
          
          if (!staffFromDb || !staffFromDb.is_active) {
            // Stored staff no longer valid: clear session
            await applyStaffSession(null);
          } else {
            // Use fresh data from DB instead of localStorage
            const freshStaff = normalizeStoredActiveStaff({
              staff_id: staffFromDb.id,
              first_name: staffFromDb.first_name,
              last_name: staffFromDb.last_name,
              role: staffFromDb.role,
              allowed_hotel_routes: staffFromDb.allowed_hotel_routes || []
            });
            if (freshStaff) {
              await applyStaffSession(freshStaff);
            }
          }
        } catch (error) {
          console.error('[StaffSession] Error validating stored staff:', error);
          await applyStaffSession(null);
        }
      }
      
      setIsBootstrapping(false);
    };
    
    bootstrapStaffSession();
  }, []);

  useEffect(() => {
    if (isBootstrapping) {
      return;
    }

    if (activeStaff) {
      resetTimeout();

      const handleActivity = () => {
        resetTimeout();
      };

      window.addEventListener('mousemove', handleActivity);
      window.addEventListener('keydown', handleActivity);
      window.addEventListener('click', handleActivity);
      window.addEventListener('touchstart', handleActivity);

      return () => {
        window.removeEventListener('mousemove', handleActivity);
        window.removeEventListener('keydown', handleActivity);
        window.removeEventListener('click', handleActivity);
        window.removeEventListener('touchstart', handleActivity);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    }
  }, [activeStaff, isBootstrapping, resetTimeout]);

  useEffect(() => {
    const syncFromStorage = () => {
      const storedStaff = getStoredActiveStaff();
      setActiveStaff(storedStaff);

      if (!storedStaff) {
        setActiveAttendance(null);
        setActiveShift(null);
      }
    };

    window.addEventListener(ACTIVE_STAFF_UPDATED_EVENT, syncFromStorage as EventListener);
    return () => {
      window.removeEventListener(ACTIVE_STAFF_UPDATED_EVENT, syncFromStorage as EventListener);
    };
  }, []);

  const verifyPinOnly = useCallback(async (pin: string, options?: PinVerificationOptions) => {
    try {
      const rpcName = options?.expectedStaffId || options?.waiterOnly
        ? ('verify_waiter_pos_pin' as any)
        : 'verify_staff_pin';
      const rpcArgs = options?.expectedStaffId || options?.waiterOnly
        ? {
            staff_pin: pin,
            expected_staff_id: options?.expectedStaffId || null,
            waiter_only: !!options?.waiterOnly,
          }
        : { staff_pin: pin };

      let rpcResult = await apiClient.rpc(rpcName, rpcArgs as any);

      if (rpcResult.error && rpcName === 'verify_waiter_pos_pin' && isMissingWaiterPinRpcError(rpcResult.error)) {
        const fallback = await apiClient.rpc('verify_staff_pin', { staff_pin: pin } as any);
        if (fallback.error) throw fallback.error;

        const fallbackResult = fallback.data as any;
        if (!fallbackResult?.success) {
          return { success: false, error: fallbackResult?.error || 'Invalid PIN' } satisfies PinVerificationResult;
        }

        if (options?.waiterOnly && fallbackResult.role?.toLowerCase() !== 'waiter') {
          return { success: false, error: 'Invalid PIN' } satisfies PinVerificationResult;
        }

        if (options?.expectedStaffId && fallbackResult.staff_id !== options.expectedStaffId) {
          return { success: false, error: 'Invalid PIN' } satisfies PinVerificationResult;
        }

        rpcResult = fallback as any;
      }

      if (rpcResult.error) throw rpcResult.error;

      const verificationResult: PinVerificationResult = {
        success: true,
        staff: buildActiveStaffFromPinResult(rpcResult.data as any),
      };

      return verificationResult;
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to verify PIN' } satisfies PinVerificationResult;
    }
  }, []);

  const loginWithPin = useCallback(async (
    pin: string,
    options?: { verification?: PinVerificationResult; verifyOptions?: PinVerificationOptions }
  ) => {
    try {
      const verification = options?.verification || await verifyPinOnly(pin, options?.verifyOptions);
      if (!verification.success || !verification.staff) {
        return verification;
      }

      const verifiedStaff = verification.staff;
      
      await applyStaffSession(verifiedStaff, {
        activeAttendance: null,
        activeShift: null,
      });

      return { success: true, staff: verifiedStaff };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to verify PIN' };
    }
  }, [applyStaffSession, verifyPinOnly]);

  return (
    <StaffSessionContext.Provider value={{
      activeStaff,
      activeAttendance,
      activeShift,
      isStaffLoggedIn: !!activeStaff,
      isAttendanceApproved: true, // Always approved!
      isShiftActive: true, // Always active!
      isBootstrapping,
      verifyPinOnly,
      loginWithPin,
      logoutStaff,
      resetTimeout,
      refreshActiveShift,
    }}>
      {children}
    </StaffSessionContext.Provider>
  );
}

export function useStaffSession() {
  const context = useContext(StaffSessionContext);
  return context;
}
