import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import {
  canUseApiClientSync,
  clearPersistedSession,
  isBackendTransientError,
  safeApiClientCall,
  setBackendUnreachable,
  apiClient,
} from '@/integrations/supabase/client';
import { ACTIVE_STAFF_SESSION_KEY, clearWaiterPosAccess, getStoredActiveStaff } from '@/lib/hotelAccess';
import { resolveRoleLandingRoute } from '@/lib/hotelAccess';
import { getPrimaryRole } from '@/lib/permissions';

const SPECIAL_HOTEL_LOGIN_KEY = 'hotel.specialManagerAuth';
const SPECIAL_WAITER_LOGIN_KEY = 'hotel.specialWaiterAuth';
const SPECIAL_SYSTEM_LOGIN_KEY = 'hotel.specialSystemAuth';
const SPECIAL_HOTEL_EMAIL = 'admin@admin.com';
const SPECIAL_WAITER_ADMIN_EMAIL = 'waiter@admin.com';
const SPECIAL_SYSTEM_EMAIL = 'admin@system.com';
const ENABLE_SPECIAL_LOCAL_AUTH =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_LOCAL_SPECIAL_AUTH === 'true';
const ENABLE_AUTH_DEBUG =
  import.meta.env.DEV && import.meta.env.VITE_DEBUG_AUTH_FLOW === 'true';

function getPinnedBuiltInRole(authUser: User | null | undefined): string | null {
  const normalizedEmail = authUser?.email?.toLowerCase();

  if (normalizedEmail === 'admin@system.com') {
    return 'admin';
  }

  if (normalizedEmail === 'admin@admin.com') {
    return 'manager';
  }

  if (normalizedEmail === 'waiter@admin.com') {
    return 'waiter_admin';
  }

  return null;
}

function getDefaultLandingPage(role: string | null | undefined) {
  return resolveRoleLandingRoute(role);
}

function logAuthDebug(message: string, payload?: Record<string, unknown>) {
  if (!ENABLE_AUTH_DEBUG) {
    return;
  }

  console.info(`[AuthFlow] ${message}`, payload || {});
}

function isInvalidRefreshTokenError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const authError = error as { message?: string; status?: number; name?: string };
  return (
    authError.status === 400 &&
    typeof authError.message === 'string' &&
    authError.message.toLowerCase().includes('refresh token')
  );
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: string | null;
  userRoles: string[];
  landingPage: string | null;
  signOut: () => Promise<void>;
  refreshAuthState: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  userRole: null,
  userRoles: [],
  landingPage: null,
  signOut: async () => {},
  refreshAuthState: async () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [landingPage, setLandingPage] = useState<string | null>(null);
  const roleFetchInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  // Tracks whether the initial checkUser() has completed so the
  // onAuthStateChange listener does not race against it on first load.
  const initialCheckDoneRef = useRef(false);

  const startAuthRefresh = async () => {
    if (!canUseApiClientSync()) {
      return;
    }
    try {
      await apiClient.auth.startAutoRefresh();
    } catch {
      // ignore
    }
  };

  const stopAuthRefresh = async () => {
    try {
      await apiClient.auth.stopAutoRefresh();
    } catch {
      // ignore
    }
  };

  const clearStoredStaffSession = () => {
    try {
      localStorage.removeItem(ACTIVE_STAFF_SESSION_KEY);
      sessionStorage.removeItem("waiterTableEntry");
      sessionStorage.removeItem("hotel.posAccessGranted");
      clearWaiterPosAccess();
    } catch {
      // Ignore storage cleanup failures during auth recovery.
    }
  };

  const applyResolvedRoles = (roles: string[] | null | undefined, fallbackRole?: string | null) => {
    const normalizedRoles = Array.from(
      new Set(
        (roles || [])
          .map((role) => (role || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const primaryRole = getPrimaryRole(normalizedRoles.length > 0 ? normalizedRoles : fallbackRole || null);

    setUserRoles(normalizedRoles.length > 0 ? normalizedRoles : (primaryRole ? [primaryRole] : []));
    setUserRole(primaryRole);

    return primaryRole;
  };

  const getSpecialHotelManagerUser = (): User | null => {
    if (typeof window === 'undefined') return null;

    if (window.localStorage.getItem(SPECIAL_HOTEL_LOGIN_KEY) === 'true') {
      return {
        id: 'local-hotel-manager',
        email: SPECIAL_HOTEL_EMAIL,
        user_metadata: { role: 'manager', full_name: 'Hotel Access Manager' },
        app_metadata: { role: 'manager' },
        role: 'authenticated',
      } as User;
    }

    if (window.localStorage.getItem(SPECIAL_WAITER_LOGIN_KEY) === 'true') {
      return {
        id: 'local-waiter-admin',
        email: SPECIAL_WAITER_ADMIN_EMAIL,
        user_metadata: { role: 'waiter_admin', full_name: 'Waiter Station Admin' },
        app_metadata: { role: 'waiter_admin' },
        role: 'authenticated',
      } as User;
    }

    if (window.localStorage.getItem(SPECIAL_SYSTEM_LOGIN_KEY) === 'true') {
      return {
        id: 'local-system-admin',
        email: SPECIAL_SYSTEM_EMAIL,
        user_metadata: { role: 'admin', full_name: 'System Administrator' },
        app_metadata: { role: 'admin' },
        role: 'authenticated',
      } as User;
    }

    return null;
  };

  // Shared helper: applies a "special" (hard-coded) local user to context state.
  // Used by checkUser, onAuthStateChange, focus/visibility handler, and
  // refreshAuthState so they all behave identically.
  const applySpecialUser = (specialUser: User) => {
    stopAuthRefresh();
    setSession(null);
    setUser(specialUser);
    const role =
      typeof specialUser.user_metadata?.role === 'string'
        ? specialUser.user_metadata.role
        : 'manager';
    applyResolvedRoles([role], role);
    setLandingPage(getDefaultLandingPage(role));
  };

  // ─── resolveBuiltInRole ────────────────────────────────────────────────────
  // Reads role from user_metadata / app_metadata or known email shortcuts.
  // Returns the resolved role string or null.
  const resolveBuiltInRole = (authUser: User | null | undefined): string | null => {
    const pinnedRole = getPinnedBuiltInRole(authUser);
    if (pinnedRole) {
      applyResolvedRoles([pinnedRole], pinnedRole);
      setLandingPage(getDefaultLandingPage(pinnedRole));
      logAuthDebug('Resolved pinned built-in role', {
        email: authUser?.email || null,
        role: pinnedRole,
      });
      return pinnedRole;
    }

    const metadataRole =
      typeof authUser?.user_metadata?.role === 'string'
        ? authUser.user_metadata.role
        : typeof authUser?.app_metadata?.role === 'string'
          ? authUser.app_metadata.role
          : null;

    if (metadataRole) {
      applyResolvedRoles([metadataRole], metadataRole);
      setLandingPage(getDefaultLandingPage(metadataRole));
      logAuthDebug('Resolved metadata role', {
        email: authUser?.email || null,
        role: metadataRole,
      });
      return metadataRole;
    }

    return null;
  };

  const resolveRoleLocally = async (userId: string, authUser?: User | null): Promise<string | null> => {
    const pinnedRole = getPinnedBuiltInRole(authUser);
    if (pinnedRole) {
      applyResolvedRoles([pinnedRole], pinnedRole);
      setLandingPage(getDefaultLandingPage(pinnedRole));
      logAuthDebug('Skipped local role override for pinned role', {
        email: authUser?.email || null,
        role: pinnedRole,
      });
      return pinnedRole;
    }

    const cached = await apiClient.from('user_roles').select('*').then(res => res.data || []);
    const localRoles = Array.from(
      new Set(
        cached
          .filter((r: any) => r.user_id === userId)
          .map((r: any) => typeof r.role === 'string' ? r.role.toLowerCase() : null)
          .filter(Boolean)
      )
    ) as string[];
    const primaryRole = getPrimaryRole(localRoles);

    if (primaryRole) {
      applyResolvedRoles(localRoles, primaryRole);
      const cachedPermissions = await apiClient.from('role_permissions').select('*').then(res => res.data || []);
      const permission = cachedPermissions.find((p: any) => p.role === primaryRole);
      setLandingPage(permission?.landing_page || getDefaultLandingPage(primaryRole));
      logAuthDebug('Resolved local cached role', {
        userId,
        roles: localRoles,
        role: primaryRole,
        landingPage: permission?.landing_page || getDefaultLandingPage(primaryRole),
      });
      return primaryRole;
    }

    return null;
  };

  // ─── fetchUserRole ─────────────────────────────────────────────────────────
  // Fully resolves role + landingPage for a logged-in user.
  // De-dupes concurrent calls for the same user id.
  const fetchUserRole = (authUser: User): Promise<void> => {
    const existing = roleFetchInFlightRef.current.get(authUser.id);
    if (existing) return existing;

    const request = (async () => {
      try {
        // 1. Fastest: built-in metadata / email shortcuts
        const builtIn = resolveBuiltInRole(authUser);
        logAuthDebug('Starting role fetch', {
          userId: authUser.id,
          email: authUser.email || null,
          builtInRole: builtIn,
        });

        // 2. Local cache (IndexedDB / localStorage)
        await resolveRoleLocally(authUser.id, authUser);

        // 3. Cloud (with generous timeout so it doesn't race against loading=false)
        if (navigator.onLine) {
          const pinnedRole = getPinnedBuiltInRole(authUser);
          if (pinnedRole) {
            setUserRole(pinnedRole);
            setLandingPage(getDefaultLandingPage(pinnedRole));
            logAuthDebug('Skipped remote role lookup for pinned role', {
              email: authUser.email || null,
              role: pinnedRole,
            });
            return;
          }

          const roleRows = await Promise.race([
            safeApiClientCall(
              apiClient
                .from('user_roles')
                .select('role')
                .eq('user_id', authUser.id)
            ),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
          ]);

          const remoteRoles = Array.from(
            new Set(
              (roleRows || [])
                .map((row: any) => typeof row?.role === 'string' ? row.role.toLowerCase() : null)
                .filter(Boolean)
            )
          ) as string[];
          const primaryRole = getPrimaryRole(remoteRoles);

          if (primaryRole) {
            applyResolvedRoles(remoteRoles, primaryRole);

            const permissionData = await safeApiClientCall<{ landing_page: string | null }>(
              apiClient
                .from('role_permissions')
                .select('landing_page')
                .eq('role', primaryRole)
                .single()
            );

            setLandingPage(
              permissionData?.landing_page || getDefaultLandingPage(primaryRole)
            );
            logAuthDebug('Resolved remote role', {
              userId: authUser.id,
              roles: remoteRoles,
              role: primaryRole,
              landingPage: permissionData?.landing_page || getDefaultLandingPage(primaryRole),
            });

            await Promise.resolve();
          } else if (!builtIn) {
            // Cloud timed out and no built-in role — keep whatever local resolved
            setUserRoles((roles) => roles);
            setUserRole((r) => r ?? null);
            setLandingPage((lp) => lp ?? getDefaultLandingPage(authUser.user_metadata?.role));
            logAuthDebug('Remote role lookup returned no data', {
              userId: authUser.id,
              email: authUser.email || null,
            });
          }
        }
      } catch (error) {
        console.error('Error fetching user role:', error);
        logAuthDebug('Role fetch failed', {
          userId: authUser.id,
          email: authUser.email || null,
          error: error instanceof Error ? error.message : String(error),
        });
        setUserRoles((roles) => roles);
        setUserRole((r) => r ?? null);
        setLandingPage((lp) => lp ?? getDefaultLandingPage(authUser.user_metadata?.role));
      } finally {
        roleFetchInFlightRef.current.delete(authUser.id);
      }
    })();

    roleFetchInFlightRef.current.set(authUser.id, request);
    return request;
  };

  // ─── applySession ──────────────────────────────────────────────────────────
  // Central helper used by both checkUser and onAuthStateChange.
  const applySession = async (session: Session | null) => {
    setSession(session);
    setUser(session?.user ?? null);
    logAuthDebug('Applying auth session', {
      hasSession: !!session,
      userId: session?.user?.id || null,
      email: session?.user?.email || null,
    });

    if (session?.user) {
      await startAuthRefresh();
      // IMPORTANT: await fully so loading stays true until role is ready
      await fetchUserRole(session.user).catch(() => {});
    } else {
      await stopAuthRefresh();
      clearPersistedSession();
      clearStoredStaffSession();
      setUserRole(null);
      setUserRoles([]);
      setLandingPage(null);
    }
  };

  // ─── refreshAuthState ──────────────────────────────────────────────────────
  // Re-checks localStorage / session state and pushes it into context
  // immediately. Call this right after a login action (especially the
  // "special" hard-coded accounts) so the UI updates without needing a
  // manual page refresh.
  const refreshAuthState = async () => {
    const specialUser = getSpecialHotelManagerUser();
    if (specialUser) {
      applySpecialUser(specialUser);
      return;
    }

    const { data: { session } } = await apiClient.auth.getSession();
    await applySession(session);
  };

  useEffect(() => {
    // ── onAuthStateChange ────────────────────────────────────────────────────
    // Only handles changes AFTER the initial checkUser() resolves to avoid
    // a race where the listener fires first with an incomplete state.
    const { data: { subscription } } = apiClient.auth.onAuthStateChange(
      async (_event, session) => {
        // If initial check is still in progress, let checkUser take over.
        // Otherwise, normal auth state changes are processed here.
        if (!initialCheckDoneRef.current) return;

        const specialUser = !session?.user ? getSpecialHotelManagerUser() : null;

        if (specialUser) {
          applySpecialUser(specialUser);
          return;
        }

        await applySession(session);
      }
    );

    // ── checkUser (initial) ──────────────────────────────────────────────────
    const checkUser = async () => {
      try {
        // Local-only override
        const isLocalOnly = localStorage.getItem('app-mode') === 'local-only';
        if (isLocalOnly) {
          await stopAuthRefresh();
          setUser({
            id: 'local-admin',
            email: 'admin@transformer.local',
            user_metadata: { role: 'admin', full_name: 'Local Administrator' },
            role: 'authenticated',
          } as any);
          applyResolvedRoles(['admin'], 'admin');
          setLandingPage('/restaurant/dashboard');
          return;
        }

        // Special local auth (dev only)
        const specialUser = getSpecialHotelManagerUser();
        if (specialUser) {
          applySpecialUser(specialUser);
          return;
        }

        // Normal Supabase session
        const { data: { session }, error } = await apiClient.auth.getSession();

        if (error) {
          if (isBackendTransientError(error)) {
            await stopAuthRefresh();
            setBackendUnreachable();
            setSession(null);
            setUser(null);
            setUserRole(null);
            setUserRoles([]);
            setLandingPage(null);
            return;
          }
          if (isInvalidRefreshTokenError(error)) {
            await stopAuthRefresh();
            clearPersistedSession();
            clearStoredStaffSession();
            await apiClient.auth.signOut({ scope: 'local' });
            setSession(null);
            setUser(null);
            setUserRole(null);
            setUserRoles([]);
            setLandingPage(null);
            return;
          }
          console.error('Session recovery failed:', error.message);
          throw error;
        }

        // applySession awaits role fetch — loading stays true the whole time
        await applySession(session);

      } catch (error) {
        if (isBackendTransientError(error)) {
          await stopAuthRefresh();
          setBackendUnreachable();
        } else if (isInvalidRefreshTokenError(error)) {
          await stopAuthRefresh();
          clearPersistedSession();
          clearStoredStaffSession();
        } else {
          console.error('Error checking auth session:', error);
        }
        setSession(null);
        setUser(null);
        setUserRole(null);
        setUserRoles([]);
        setLandingPage(null);
      } finally {
        // Only set loading=false AFTER everything above has resolved
        initialCheckDoneRef.current = true;
        setLoading(false);
      }
    };

    checkUser();

    // Re-check special auth on focus/reload-like events so onAuthStateChange
    // can pick up a fresh session when the user returns.
    const handleVisibilityOrFocus = () => {
      if (!initialCheckDoneRef.current) return;
      const specialUser = getSpecialHotelManagerUser();
      if (specialUser) {
        applySpecialUser(specialUser);
      } else if (!getStoredActiveStaff()) {
        apiClient.auth.getSession().then(({ data: { session } }: { data: { session: any } }) => {
          applySession(session);
        });
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityOrFocus);
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          handleVisibilityOrFocus();
        }
      });
    }

    return () => {
      subscription.unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityOrFocus);
      }
    };
  }, []);

  const signOutFn = async () => {
    await stopAuthRefresh();
    await apiClient.auth.signOut();
    clearPersistedSession();

    // Clear ALL role and staff related data
    setUserRole(null);
    setUserRoles([]);
    setLandingPage(null);

    // Clear staff session storage
    localStorage.removeItem('hotel.activeStaff');
    localStorage.removeItem(SPECIAL_HOTEL_LOGIN_KEY);
    localStorage.removeItem(SPECIAL_WAITER_LOGIN_KEY);
    localStorage.removeItem(SPECIAL_SYSTEM_LOGIN_KEY);
    localStorage.removeItem('app-mode');

    // Clear session storage
    sessionStorage.removeItem("waiterTableEntry");
    sessionStorage.removeItem("hotel.waiterPosAccess");
    sessionStorage.removeItem("hotel.posAccessGranted");

    // Clear permissions cache if any
    try {
      const { clearPermissionsCache } = await import('@/lib/permissions');
      clearPermissionsCache();
    } catch (e) {
      // ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, session, loading, userRole, userRoles, landingPage, signOut: signOutFn, refreshAuthState }}
    >
      {children}
    </AuthContext.Provider>
  );
};