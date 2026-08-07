import { useCallback } from "react";
import { NavigateOptions, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { isStaffShellAccount } from "@/lib/hotelAccess";
import {
  hasFullAccessRole,
  hasNavigationItemAccess,
  normalizeRoutePath,
  UserRole,
} from "@/lib/permissions";

interface GuardedNavigateOptions {
  fallbackPaths?: string[];
  navigateOptions?: NavigateOptions;
  deniedMessage?: string;
}

export function useNavigationAccess() {
  const navigate = useNavigate();
  const { user, userRole, userRoles } = useAuth();
  const { activeStaff } = useStaffSession();
  const { data: rolePermissions } = useRolePermissions();
  const isSystemAdmin = hasFullAccessRole(userRoles.length > 0 ? userRoles : userRole);
  const isStaffShellUser = isStaffShellAccount(user?.email);
  const usesStaffScopedAccess = !!activeStaff && (isStaffShellUser || !isSystemAdmin);

  const allowedHotelRoutes = usesStaffScopedAccess ? (activeStaff?.allowed_hotel_routes || []) : [];
  const effectiveRoles = usesStaffScopedAccess
    ? [activeStaff?.role || userRole].filter(Boolean)
    : userRoles;

  const canAccessRoute = useCallback(
    (path: string) =>
      hasNavigationItemAccess(
        normalizeRoutePath(path),
        effectiveRoles as UserRole[],
        rolePermissions,
        allowedHotelRoutes
      ),
    [allowedHotelRoutes, effectiveRoles, rolePermissions]
  );

  const findFirstAccessibleRoute = useCallback(
    (paths: string[]) => {
      for (const path of paths) {
        const normalizedPath = normalizeRoutePath(path);
        if (canAccessRoute(normalizedPath)) {
          return path;
        }
      }

      return null;
    },
    [canAccessRoute]
  );

  const showAccessDenied = useCallback((message?: string) => {
    toast.error(
      message || "Access denied. You do not have permission to open this page."
    );
  }, []);

  const navigateIfAllowed = useCallback(
    (path: string, options: GuardedNavigateOptions = {}) => {
      const normalizedPath = normalizeRoutePath(path);

      if (canAccessRoute(normalizedPath)) {
        navigate(path, options.navigateOptions);
        return true;
      }

      showAccessDenied(options.deniedMessage);

      const fallbackPath = options.fallbackPaths
        ? findFirstAccessibleRoute(options.fallbackPaths)
        : null;

      if (fallbackPath) {
        navigate(fallbackPath, { replace: true, ...options.navigateOptions });
      }

      return false;
    },
    [canAccessRoute, findFirstAccessibleRoute, navigate, showAccessDenied]
  );

  return {
    allowedHotelRoutes,
    canAccessRoute,
    findFirstAccessibleRoute,
    navigateIfAllowed,
    showAccessDenied,
  };
}
