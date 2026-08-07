import { useEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffSession } from '@/contexts/StaffSessionContext';
import { StaffPinLogin } from '@/components/hotel/StaffPinLogin';
import { WaiterTableEntry } from '@/components/hotel/WaiterTableEntry';
import { ShiftStartScreen } from '@/components/auth/ShiftStartScreen';
import { Loader2 } from 'lucide-react';
import { getStaffRedirectCandidates, hasWaiterPosAccess, isStaffShellAccount, isWaiterStaff, normalizeStaffRole, resolveRoleLandingRoute, resolveStaffHomeRoute } from '@/lib/hotelAccess';
import { hasFullAccessRole, hasNavigationItemAccess, hasRouteAccessWithData, UserRole } from '@/lib/permissions';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { toast } from 'sonner';

const ENABLE_AUTH_DEBUG =
  import.meta.env.DEV && import.meta.env.VITE_DEBUG_AUTH_FLOW === 'true';

function logRouteGuardDebug(message: string, payload?: Record<string, unknown>) {
  if (!ENABLE_AUTH_DEBUG) {
    return;
  }

  console.info(`[RouteGuard] ${message}`, payload || {});
}

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRoles }) => {
  const { user, loading, userRole, userRoles, landingPage, signOut } = useAuth();
  const { activeStaff, isStaffLoggedIn, isAttendanceApproved, isShiftActive, isBootstrapping, logoutStaff } = useStaffSession();
  const location = useLocation();
  const { data: rolePermissions, isLoading: permissionsLoading } = useRolePermissions();
  const lastDeniedPathRef = useRef<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const lastStaffIdRef = useRef<string | null>(null);
  const isSystemAdmin = hasFullAccessRole(Array.isArray(userRoles) && userRoles.length > 0 ? userRoles : userRole);
  const isStaffShellUser = isStaffShellAccount(user?.email);
  const usesStaffScopedAccess = !!activeStaff && (isStaffShellUser || !isSystemAdmin);

  const effectiveRole = usesStaffScopedAccess ? activeStaff?.role || userRole : userRole;
  const effectiveRoles = usesStaffScopedAccess
    ? [activeStaff?.role || userRole].filter(Boolean)
    : (Array.isArray(userRoles) ? userRoles : []);
  const allowedHotelRoutes = usesStaffScopedAccess ? (activeStaff?.allowed_hotel_routes || []) : [];
  const fallbackRoute = usesStaffScopedAccess && activeStaff
    ? resolveStaffHomeRoute(activeStaff)
    : (landingPage || resolveRoleLandingRoute(userRole));

  // Reset denial ref when user or staff changes
  useEffect(() => {
    if (user?.id !== lastUserIdRef.current || activeStaff?.staff_id !== lastStaffIdRef.current) {
      lastDeniedPathRef.current = null;
      lastUserIdRef.current = user?.id || null;
      lastStaffIdRef.current = activeStaff?.staff_id || null;
    }
  }, [user?.id, activeStaff?.staff_id]);

  const hasAccess = requiredRoles
    ? effectiveRoles.some((role) => requiredRoles.includes(role as UserRole))
    : activeStaff
      ? hasNavigationItemAccess(
          location.pathname,
          effectiveRoles as UserRole[],
          permissionsLoading ? null : (rolePermissions || null),
          allowedHotelRoutes
        )
      : hasRouteAccessWithData(
          location.pathname,
          effectiveRoles as UserRole[],
          permissionsLoading ? null : (rolePermissions || null)
        );

  useEffect(() => {
    if (!loading && user && !hasAccess && lastDeniedPathRef.current !== location.pathname) {
      lastDeniedPathRef.current = location.pathname;
      logRouteGuardDebug('Access denied', {
        path: location.pathname,
        userId: user.id,
        userRole,
        effectiveRole,
        isSystemAdmin,
        activeStaffId: activeStaff?.staff_id || null,
        activeStaffRole: activeStaff?.role || null,
        fallbackRoute,
      });
      toast.error(`Access denied: you cannot open ${location.pathname}.`);
    }
  }, [activeStaff?.role, activeStaff?.staff_id, effectiveRole, fallbackRoute, hasAccess, isSystemAdmin, loading, location.pathname, user, userRole]);

  useEffect(() => {
    if (loading || isBootstrapping || !user) {
      return;
    }

    logRouteGuardDebug('Evaluated protected route', {
      path: location.pathname,
      userId: user.id,
      userRole,
      effectiveRole,
      isSystemAdmin,
      hasAccess,
      isStaffLoggedIn,
      isAttendanceApproved,
      isShiftActive,
      activeStaffId: activeStaff?.staff_id || null,
      activeStaffRole: activeStaff?.role || null,
      fallbackRoute,
    });
  }, [activeStaff?.role, activeStaff?.staff_id, effectiveRole, fallbackRoute, hasAccess, isAttendanceApproved, isBootstrapping, isShiftActive, isStaffLoggedIn, isSystemAdmin, loading, location.pathname, user, userRole]);

  const isPublicAuthPage = ['/auth', '/admin-setup'].includes(location.pathname);

  const hasTableEntryState = !!(location.state as any)?.tableEntry || (() => {
  try {
    const stored = sessionStorage.getItem("waiterTableEntry");
    if (!stored) return false;
    const parsed = JSON.parse(stored);
    return parsed?.staffId === activeStaff?.staff_id;
  } catch {
    return false;
  }
})();

  const usesWaiterTableEntry = location.pathname === '/restaurant/pos';

  const requiresStaffSession = !isPublicAuthPage && (isStaffShellUser || !isSystemAdmin);
  const isWaiterShellRoute =
    location.pathname === '/restaurant/pos' &&
    ['waiter', 'waiter_admin'].includes(normalizeStaffRole(effectiveRole));

  const redirectCandidates = useMemo(() => {
    if (usesStaffScopedAccess && activeStaff) {
      return getStaffRedirectCandidates(activeStaff);
    }

    return [fallbackRoute, landingPage || resolveRoleLandingRoute(userRole)];
  }, [activeStaff, fallbackRoute, landingPage, userRole, usesStaffScopedAccess]);

  const redirectTarget = redirectCandidates.find((candidate) => {
    if (!candidate || candidate === location.pathname) {
      return false;
    }

    return activeStaff
      ? hasNavigationItemAccess(
          candidate,
          effectiveRoles as UserRole[],
          permissionsLoading ? null : (rolePermissions || null),
          allowedHotelRoutes
        )
      : hasRouteAccessWithData(
          candidate,
          effectiveRoles as UserRole[],
          permissionsLoading ? null : (rolePermissions || null)
        );
  }) || null;

  useEffect(() => {
    if (loading || isBootstrapping || !user || hasAccess || !usesStaffScopedAccess || !activeStaff) {
      return;
    }

    if (redirectTarget) {
      return;
    }

    if (lastDeniedPathRef.current === `reset:${location.pathname}`) {
      return;
    }

    lastDeniedPathRef.current = `reset:${location.pathname}`;
    toast.error('This staff PIN has no valid page here. Please use the correct PIN.');
    logoutStaff();
  }, [activeStaff, hasAccess, isBootstrapping, loading, location.pathname, logoutStaff, redirectTarget, user, usesStaffScopedAccess]);

  if (loading || isBootstrapping) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (requiresStaffSession) {
    if (!isStaffLoggedIn) {
      return (usesWaiterTableEntry && hasTableEntryState) || isWaiterShellRoute
        ? <WaiterTableEntry />
        : <StaffPinLogin />;
    }

    // Bypass ShiftStartScreen entirely - no more waiting!
    // Staff can now access the app immediately with just their PIN
    
    if (
      location.pathname === '/restaurant/pos' &&
      isWaiterStaff(activeStaff) &&
      !hasTableEntryState &&
      !hasWaiterPosAccess(activeStaff?.staff_id)
    ) {
      return <WaiterTableEntry />;
    }
  }

  if (!hasAccess) {
    if (redirectTarget) {
      return <Navigate to={redirectTarget} replace />;
    }

    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
