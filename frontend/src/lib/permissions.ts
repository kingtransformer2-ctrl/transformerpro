// Role-based access control configuration
export type UserRole = string; // Allow any string for custom roles
type RoleInput = UserRole | UserRole[] | null | undefined;

export interface RoutePermission {
  path: string;
  allowedRoles: string[];
}

export interface RolePermissionData {
  role: string;
  pos_routes: string[];
  hotel_routes: string[];
  landing_page?: string | null;
  is_system?: boolean;
  color?: string;
  icon?: string;
}

// Cache for database permissions
let cachedPermissions: RolePermissionData[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 60000; // 1 minute cache
const FULL_ACCESS_ROLES = new Set(['admin', 'manager', 'owner']);
const ROLE_PRIORITY = [
  'admin',
  'owner',
  'manager',
  'accountant',
  'cashier',
  'waiter_admin',
  'waiter',
  'chef',
  'barman',
  'receptionist',
  'housekeeping',
  'security',
  'maintenance',
  'user',
] as const;
const ROUTE_ALIASES: Record<string, string> = {
  '/hotel/new-booking': '/hotel/bookings/new',
  '/hotel/attendance': '/hotel/staff',
  '/hotel/inventory': '/restaurant/inventory',
};

/**
 * Set cached permissions from database (call this from components that fetch permissions)
 */
export function setCachedPermissions(permissions: RolePermissionData[]) {
  cachedPermissions = permissions;
  cacheTimestamp = Date.now();
}

/**
 * Clear the permissions cache (call when permissions are updated)
 */
export function clearPermissionsCache() {
  cachedPermissions = null;
  cacheTimestamp = 0;
}

/**
 * Check if cache is valid
 */
function isCacheValid(): boolean {
  return cachedPermissions !== null && (Date.now() - cacheTimestamp) < CACHE_DURATION;
}

/**
 * Get cached permissions
 */
export function getCachedPermissions(): RolePermissionData[] | null {
  return isCacheValid() ? cachedPermissions : null;
}

export function normalizeRoutePath(path: string): string {
  return ROUTE_ALIASES[path] || path;
}

function normalizeRoleListInput(userRole: RoleInput): string[] {
  if (!userRole) return [];

  const roles = Array.isArray(userRole) ? userRole : [userRole];
  return Array.from(
    new Set(
      roles
        .map((role) => (role || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function getPrimaryRole(userRole: RoleInput): string | null {
  const roles = normalizeRoleListInput(userRole);
  if (roles.length === 0) return null;

  const scoredRoles = [...roles].sort((left, right) => {
    const leftPriority = ROLE_PRIORITY.indexOf(left as (typeof ROLE_PRIORITY)[number]);
    const rightPriority = ROLE_PRIORITY.indexOf(right as (typeof ROLE_PRIORITY)[number]);
    const normalizedLeftPriority = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
    const normalizedRightPriority = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;

    if (normalizedLeftPriority !== normalizedRightPriority) {
      return normalizedLeftPriority - normalizedRightPriority;
    }

    return left.localeCompare(right);
  });

  return scoredRoles[0] || null;
}

export function hasFullAccessRole(userRole: RoleInput): boolean {
  return normalizeRoleListInput(userRole).some((role) => FULL_ACCESS_ROLES.has(role));
}

export function canManageRoleAdministration(
  userRole: RoleInput,
  permissions?: RolePermissionData[] | null
): boolean {
  const roles = normalizeRoleListInput(userRole);

  if (roles.some((role) => FULL_ACCESS_ROLES.has(role))) {
    return true;
  }

  return roles.some((role) => isAdminRole(role, permissions));
}

function normalizeRouteList(routes: string[]): string[] {
  return routes.map(normalizeRoutePath);
}

// All known routes - used for fallback deny logic
const ALL_KNOWN_POS_ROUTES = [
  '/', '/owner', '/settings', '/reports', '/stock', '/products', 
  '/loans', '/pos', '/sales', '/customers', '/scanner', '/notifications'
];

const ALL_KNOWN_HOTEL_ROUTES = [
  '/hotel', '/hotel/settings', '/hotel/staff', '/hotel/reports', '/hotel/billing',
  '/hotel/service-menu', '/hotel/pos', '/hotel/rooms', '/hotel/tables', '/hotel/bookings',
  '/hotel/new-booking', '/hotel/attendance', '/hotel/check-in-out', '/hotel/guests', '/hotel/housekeeping',
  '/hotel/shifts', '/hotel/shift-report', '/hotel/finance', '/hotel/restaurant-dashboard', '/hotel/inventory',
  '/restaurant/inventory'
];

// Fallback static permissions (used ONLY when database is not available)
// These are restrictive - custom roles get NO access in fallback mode
export const defaultPosRoutePermissions: RoutePermission[] = [
  { path: '/owner', allowedRoles: ['admin'] },
  { path: '/settings', allowedRoles: ['admin', 'manager'] },
  { path: '/reports', allowedRoles: ['admin', 'manager'] },
  { path: '/stock', allowedRoles: ['admin', 'manager'] },
  { path: '/products', allowedRoles: ['admin', 'manager'] },
  { path: '/loans', allowedRoles: ['admin', 'manager'] },
  { path: '/', allowedRoles: ['admin', 'manager', 'cashier', 'user'] },
  { path: '/pos', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/sales', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/customers', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/scanner', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/notifications', allowedRoles: ['admin', 'manager', 'cashier', 'user'] },
];

export const defaultHotelRoutePermissions: RoutePermission[] = [
  { path: '/restaurant/inventory', allowedRoles: ['admin', 'manager', 'owner'] },
  { path: '/hotel/settings', allowedRoles: ['admin', 'manager'] },
  { path: '/hotel/staff', allowedRoles: ['admin', 'manager', 'waiter_admin'] },
  { path: '/hotel/attendance', allowedRoles: ['admin', 'manager'] },
  { path: '/hotel/shifts', allowedRoles: ['admin', 'manager'] },
  { path: '/hotel/shift-report', allowedRoles: ['admin', 'manager'] },
  { path: '/hotel/reports', allowedRoles: ['admin', 'manager'] },
  { path: '/hotel/billing', allowedRoles: ['admin', 'manager'] },
  { path: '/hotel/finance', allowedRoles: ['admin', 'manager', 'accountant'] },
  { path: '/hotel/inventory', allowedRoles: ['admin', 'manager', 'owner'] },
  { path: '/hotel/service-menu', allowedRoles: ['admin', 'manager'] },
  { path: '/hotel/restaurant-dashboard', allowedRoles: ['admin', 'manager'] },
  { path: '/hotel', allowedRoles: ['admin', 'manager', 'cashier', 'user'] },
  { path: '/hotel/pos', allowedRoles: ['admin', 'manager', 'cashier', 'waiter', 'waiter_admin'] },
  { path: '/restaurant/waiter-pos', allowedRoles: ['admin', 'manager', 'waiter_admin', 'waiter'] },
  { path: '/hotel/rooms', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/hotel/tables', allowedRoles: ['admin', 'manager', 'cashier', 'waiter_admin'] },
  { path: '/hotel/bookings', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/hotel/new-booking', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/hotel/check-in-out', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/hotel/guests', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/hotel/customers', allowedRoles: ['admin', 'manager', 'cashier'] },
  { path: '/hotel/housekeeping', allowedRoles: ['admin', 'manager', 'cashier', 'user'] },
];

/**
 * Check if a role is a system role using database-driven check
 * Falls back to checking if role exists in cached permissions with is_system flag
 */
export function isSystemRole(role: string, permissions?: RolePermissionData[] | null): boolean {
  const perms = permissions || cachedPermissions;
  if (perms && perms.length > 0) {
    const roleData = perms.find(p => p.role === role);
    if (roleData) {
      return roleData.is_system === true;
    }
  }
  // Hardcoded fallback only when DB unavailable - these are always system roles
  return ['admin', 'manager', 'cashier', 'user', 'waiter_admin'].includes(role);
}

/**
 * Check if a role has admin privileges (database-driven)
 */
export function isAdminRole(role: string | null, permissions?: RolePermissionData[] | null): boolean {
  if (!role) return false;
  const normalizedRole = role.trim().toLowerCase();

  if (FULL_ACCESS_ROLES.has(normalizedRole)) {
    return true;
  }

  const perms = permissions || cachedPermissions;
  if (perms && perms.length > 0) {
    const roleData = perms.find(p => p.role === normalizedRole);
    return roleData?.is_system === true && FULL_ACCESS_ROLES.has(normalizedRole);
  }

  return FULL_ACCESS_ROLES.has(normalizedRole);
}

/**
 * Check if a user role has access to a specific route using cached database permissions
 * DENY by default - only explicitly granted routes are accessible
 */
export function hasRouteAccess(path: string, userRole: RoleInput): boolean {
  const roles = normalizeRoleListInput(userRole);
  if (roles.length === 0) return false;
  const normalizedPath = normalizeRoutePath(path);

  if (hasFullAccessRole(roles)) return true;
  
  // Use cached permissions if available
  if (isCacheValid() && cachedPermissions && cachedPermissions.length > 0) {
    for (const role of roles) {
      if (isAdminRole(role, cachedPermissions)) return true;
    }

    let matchedPermission = false;
    for (const role of roles) {
      const rolePermission = cachedPermissions.find(p => p.role === role);
      if (!rolePermission) continue;
      matchedPermission = true;

      const allRoutes = [
        ...rolePermission.pos_routes,
        ...rolePermission.hotel_routes
      ];

      if (allRoutes.includes(normalizedPath)) {
        return true;
      }
    }

    if (matchedPermission) {
      return false;
    }
  }
  
  // Fallback to static permissions (when DB unavailable)
  // Admin check for fallback
  if (roles.includes('admin')) return true;
  
  const allPermissions = [...defaultPosRoutePermissions, ...defaultHotelRoutePermissions];
  const permission = allPermissions.find(p => normalizeRoutePath(p.path) === normalizedPath);
  
  // DENY access if route not found in static permissions (secure default)
  if (!permission) return false;
  
  return roles.some((role) => permission.allowedRoles.includes(role));
}

/**
 * Check route access with explicit permissions data (for use in components)
 * DENY by default - only explicitly granted routes are accessible
 */
export function hasRouteAccessWithData(
  path: string, 
  userRole: RoleInput,
  permissions: RolePermissionData[] | null
): boolean {
  const roles = normalizeRoleListInput(userRole);
  if (roles.length === 0) return false;
  const normalizedPath = normalizeRoutePath(path);

  if (hasFullAccessRole(roles)) return true;

  if (permissions && permissions.length > 0) {
    for (const role of roles) {
      if (isAdminRole(role, permissions)) return true;
    }

    let matchedPermission = false;
    for (const role of roles) {
      const rolePermission = permissions.find(p => p.role === role);
      if (!rolePermission) continue;
      matchedPermission = true;

      const allRoutes = [
        ...rolePermission.pos_routes,
        ...rolePermission.hotel_routes
      ];

      if (allRoutes.includes(normalizedPath)) {
        return true;
      }
    }

    if (matchedPermission) {
      return false;
    }
  }
  
  // Fallback to static permissions
  if (roles.includes('admin')) return true;
  
  const allPermissions = [...defaultPosRoutePermissions, ...defaultHotelRoutePermissions];
  const permission = allPermissions.find(p => normalizeRoutePath(p.path) === normalizedPath);
  
  // DENY access if route not found (secure default)
  if (!permission) return false;
  
  return roles.some((role) => permission.allowedRoles.includes(role));
}

/**
 * Filter navigation items based on user role and database permissions
 */
export function filterNavigationByRole<T extends { href: string }>(
  items: T[],
  userRole: RoleInput,
  mode: 'pos' | 'hotel',
  permissions?: RolePermissionData[] | null
): T[] {
  const roles = normalizeRoleListInput(userRole);
  if (roles.length === 0) return [];
  
  // Use provided permissions or cached permissions
  const perms = permissions || (isCacheValid() ? cachedPermissions : null);
  
  // Check if admin role (database-driven)
  if (hasFullAccessRole(roles) || roles.some((role) => isAdminRole(role, perms))) return items;

  if (perms && perms.length > 0) {
    const allowedRoutes = new Set<string>();

    roles.forEach((role) => {
      const rolePermission = perms.find(p => p.role === role);
      if (!rolePermission) return;

      const routes = mode === 'hotel' ? rolePermission.hotel_routes : rolePermission.pos_routes;
      routes.forEach((route) => allowedRoutes.add(route));
    });

    if (allowedRoutes.size > 0) {
      return items.filter(item => allowedRoutes.has(normalizeRoutePath(item.href)));
    }
  }
  
  // Fallback to static permissions
  const staticPermissions = mode === 'hotel' ? defaultHotelRoutePermissions : defaultPosRoutePermissions;
  
  return items.filter(item => {
    const permission = staticPermissions.find(
      p => normalizeRoutePath(p.path) === normalizeRoutePath(item.href)
    );
    // DENY if route not found in static permissions
    if (!permission) return false;
    return roles.some((role) => permission.allowedRoles.includes(role));
  });
}

export function hasNavigationItemAccess(
  path: string,
  userRole: RoleInput,
  permissions?: RolePermissionData[] | null,
  allowedHotelRoutes: string[] = []
): boolean {
  const roles = normalizeRoleListInput(userRole);
  const normalizedPath = normalizeRoutePath(path);

  // Check if it's a /restaurant/ route first
  if (normalizedPath.startsWith('/restaurant')) {
    if (hasFullAccessRole(roles)) {
      return true;
    }
    if (allowedHotelRoutes.length > 0) {
      return allowedHotelRoutes.includes(normalizedPath);
    }
    // If allowedHotelRoutes not provided, fall back to role permissions
    return hasRouteAccessWithData(normalizedPath, roles, permissions || null);
  }

  // For non-/restaurant/ routes (POS routes, /hotel/ routes), use existing logic
  if (!hasRouteAccessWithData(normalizedPath, roles, permissions || null)) {
    return false;
  }

  if (
    !normalizedPath.startsWith('/hotel') ||
    allowedHotelRoutes.length === 0 ||
    hasFullAccessRole(roles)
  ) {
    return true;
  }

  return normalizeRouteList(allowedHotelRoutes).includes(normalizedPath);
}

export function filterNavigationByAccess<T extends { href: string }>(
  items: T[],
  userRole: RoleInput,
  permissions?: RolePermissionData[] | null,
  allowedHotelRoutes: string[] = []
): T[] {
  return items.filter(item =>
    hasNavigationItemAccess(item.href, userRole, permissions, allowedHotelRoutes)
  );
}

/**
 * Get role display name
 */
export function getRoleDisplayName(role: UserRole, permissions?: RolePermissionData[] | null): string {
  // Check if we have cached permissions with descriptions
  const perms = permissions || cachedPermissions;
  if (perms) {
    const roleData = perms.find(p => p.role === role);
    if (roleData) {
      // Capitalize first letter of role name
      return role.charAt(0).toUpperCase() + role.slice(1);
    }
  }
  
  // Fallback - just capitalize
  return role.charAt(0).toUpperCase() + role.slice(1);
}
