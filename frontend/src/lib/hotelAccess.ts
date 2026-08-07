import type { ActiveStaff } from '@/contexts/StaffSessionContext';
import type { HotelOrder, HotelTableStatus, OrderStatus } from '@/types/hotel';
import { clearLocalTable } from './localDataService';

export const ACTIVE_STAFF_SESSION_KEY = 'hotel.activeStaff';
export const WAITER_POS_ACCESS_KEY = 'hotel.waiterPosAccess';
export const ACTIVE_STAFF_UPDATED_EVENT = 'hotel:active-staff-updated';

export const MANAGER_LIKE_ROLES = new Set(['manager', 'owner', 'admin']);
export const KOT_QUEUE_ROLES = new Set(['chef', 'barman', 'barista']);
export const WAITER_LIKE_ROLES = new Set(['waiter', 'waiter_admin']);
export const HANDOVER_ORDER_STATUSES = ['awaiting_approval', 'pending_handover', 'confirmed'] as const;
export const ACTIVE_ORDER_STATUSES = ['pending', 'preparing', 'ready', 'served', 'awaiting_approval', 'pending_handover', 'billed'] as const;
export const TABLE_OCCUPYING_ORDER_STATUSES: OrderStatus[] = ['pending', 'preparing', 'ready', 'served', 'awaiting_approval', 'pending_handover', 'billed'];

export const INVENTORY_LOCATIONS = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bar', label: 'Bar' },
] as const;

export type HotelInventoryLocation = (typeof INVENTORY_LOCATIONS)[number]['value'];
export type HotelInventoryMovementType = 'in' | 'out' | 'transfer' | 'adjustment';
export type HotelIngredientCategory =
  | 'beverages'
  | 'fresh_produce'
  | 'dry_goods'
  | 'protein'
  | 'dairy'
  | 'spices'
  | 'other';
const HOTEL_ISOLATION_CACHE_TABLES = [
  'hotel_orders',
  'hotel_order_items',
  'hotel_table_sessions',
  'hotel_table_session_seats',
  'hotel_table_payment_groups',
  'hotel_table_payment_group_seats',
  'hotel_staff_shifts',
  'hotel_shift_logs',
  'hotel_shift_transactions',
  'hotel_transactions',
  'hotel_kot',
  'hotel_handovers',
];

type StaffLike = Pick<ActiveStaff, 'staff_id' | 'role'> | null | undefined;
type StaffRoutingLike = Pick<ActiveStaff, 'role' | 'allowed_hotel_routes'> | null | undefined;

type WaiterPosAccessState = {
  staffId: string;
  tableId: string;
  tableNumber: string;
  grantedAt: number;
};

const STAFF_HOME_ROUTE_CANDIDATES: Record<string, string[]> = {
  waiter: ['/restaurant/waiter-pos'],
  waiter_admin: ['/restaurant/waiter-pos', '/restaurant/staff', '/restaurant/shifts'],
  chef: ['/restaurant/kitchen', '/restaurant/dashboard'],
  barman: ['/restaurant/bar', '/restaurant/dashboard'],
  barista: ['/restaurant/bar', '/restaurant/dashboard'],
  cashier: ['/restaurant/billing', '/restaurant/pos', '/restaurant/dashboard'],
  receptionist: ['/restaurant/dashboard', '/restaurant/billing', '/restaurant/pos'],
  housekeeping: ['/restaurant/dashboard'],
  accountant: ['/restaurant/finance', '/restaurant/reports', '/restaurant/dashboard'],
  manager: ['/restaurant/dashboard', '/restaurant/reports', '/restaurant/staff', '/restaurant/pos'],
  owner: ['/restaurant/dashboard', '/restaurant/reports', '/restaurant/staff', '/restaurant/settings'],
  admin: ['/restaurant/dashboard', '/restaurant/reports', '/restaurant/staff', '/restaurant/settings'],
};

const STAFF_ROLE_ROUTE_PRESETS: Record<string, string[]> = {
  waiter: ['/restaurant/waiter-pos'],
  waiter_admin: ['/restaurant/waiter-pos', '/restaurant/staff', '/restaurant/shifts', '/restaurant/tables'],
  chef: ['/restaurant/kitchen'],
  barman: ['/restaurant/bar'],
  barista: ['/restaurant/bar'],
  cashier: ['/restaurant/billing', '/restaurant/pos'],
  receptionist: ['/restaurant/dashboard', '/restaurant/billing', '/restaurant/pos', '/restaurant/tables'],
  housekeeping: ['/restaurant/dashboard'],
  accountant: ['/restaurant/finance', '/restaurant/reports'],
  security: ['/restaurant/dashboard'],
  maintenance: ['/restaurant/dashboard'],
  manager: [
    '/restaurant/dashboard',
    '/restaurant/pos',
    '/restaurant/tables',
    '/restaurant/menu',
    '/restaurant/inventory',
    '/restaurant/billing',
    '/restaurant/staff',
    '/restaurant/attendance',
    '/restaurant/shifts',
    '/restaurant/shift-report',
    '/restaurant/finance',
    '/restaurant/reports',
    '/restaurant/settings',
    '/restaurant/kitchen',
    '/restaurant/bar',
    '/restaurant/customers',
    '/restaurant/products',
    '/restaurant/stock',
    '/restaurant/sales',
    '/restaurant/loans',
  ],
  owner: [
    '/restaurant/dashboard',
    '/restaurant/pos',
    '/restaurant/tables',
    '/restaurant/menu',
    '/restaurant/inventory',
    '/restaurant/billing',
    '/restaurant/staff',
    '/restaurant/attendance',
    '/restaurant/shifts',
    '/restaurant/shift-report',
    '/restaurant/finance',
    '/restaurant/reports',
    '/restaurant/settings',
    '/restaurant/kitchen',
    '/restaurant/bar',
    '/restaurant/customers',
    '/restaurant/products',
    '/restaurant/stock',
    '/restaurant/sales',
    '/restaurant/loans',
  ],
  admin: [
    '/restaurant/dashboard',
    '/restaurant/pos',
    '/restaurant/tables',
    '/restaurant/menu',
    '/restaurant/inventory',
    '/restaurant/billing',
    '/restaurant/staff',
    '/restaurant/attendance',
    '/restaurant/shifts',
    '/restaurant/shift-report',
    '/restaurant/finance',
    '/restaurant/reports',
    '/restaurant/settings',
    '/restaurant/kitchen',
    '/restaurant/bar',
    '/restaurant/customers',
    '/restaurant/products',
    '/restaurant/stock',
    '/restaurant/sales',
    '/restaurant/loans',
  ],
};

export function normalizeStaffRole(role?: string | null) {
  return (role || '').trim().toLowerCase();
}

export function isStaffShellAccount(email?: string | null) {
  return (email || '').trim().toLowerCase() === 'admin@system.com';
}

export function getStaffHomeRouteCandidates(role?: string | null) {
  const normalizedRole = normalizeStaffRole(role);
  return STAFF_HOME_ROUTE_CANDIDATES[normalizedRole] || ['/restaurant/dashboard'];
}

export function resolveRoleLandingRoute(role?: string | null) {
  return getStaffHomeRouteCandidates(role)[0] || '/restaurant/dashboard';
}

export function getDefaultStaffAllowedRoutes(role?: string | null) {
  const normalizedRole = normalizeStaffRole(role);
  return [...(STAFF_ROLE_ROUTE_PRESETS[normalizedRole] || [])];
}

export function normalizeStaffAllowedRoutes(role?: string | null, routes?: string[] | null) {
  const normalizedRole = normalizeStaffRole(role);
  const normalizedRoutes = Array.from(
    new Set((routes || []).filter((path) => path && path.startsWith('/restaurant/')))
  );
  const defaultRoutes = getDefaultStaffAllowedRoutes(normalizedRole);

  if (MANAGER_LIKE_ROLES.has(normalizedRole)) {
    return Array.from(new Set([...defaultRoutes, ...normalizedRoutes]));
  }

  if (normalizedRoutes.length > 0) {
    return normalizedRoutes;
  }

  return defaultRoutes;
}

export function normalizeStoredActiveStaff(staff: ActiveStaff | null) {
  if (!staff) {
    return null;
  }

  return {
    ...staff,
    role: normalizeStaffRole(staff.role),
    allowed_hotel_routes: normalizeStaffAllowedRoutes(staff.role, staff.allowed_hotel_routes),
  } satisfies ActiveStaff;
}

export function canCustomizeStaffRoutes(role?: string | null) {
  const normalizedRole = normalizeStaffRole(role);
  return normalizedRole === 'manager' || normalizedRole === 'owner' || normalizedRole === 'admin';
}

export function resolveStaffHomeRoute(staff: StaffRoutingLike) {
  const candidates = getStaffHomeRouteCandidates(staff?.role);
  const allowedRoutes = (staff?.allowed_hotel_routes || []);

  if (allowedRoutes.length === 0) {
    return candidates[0] || '/restaurant/dashboard';
  }

  const matchedCandidate = candidates.find((path) => allowedRoutes.includes(path));
  if (matchedCandidate) {
    return matchedCandidate;
  }

  const firstAllowedRoute = allowedRoutes[0];
  if (firstAllowedRoute) {
    return firstAllowedRoute;
  }

  return candidates[0] || '/restaurant/dashboard';
}

export function getStaffRedirectCandidates(staff: StaffRoutingLike) {
  const explicitAllowedRoutes = (staff?.allowed_hotel_routes || []);
  const preferredRoutes = [
    resolveStaffHomeRoute(staff),
    ...getStaffHomeRouteCandidates(staff?.role),
    ...explicitAllowedRoutes,
  ];

  return Array.from(new Set(preferredRoutes.filter(Boolean)));
}

export function isWaiterStaff(staff: StaffLike) {
  return WAITER_LIKE_ROLES.has(normalizeStaffRole(staff?.role));
}

export function isCashierStaff(staff: StaffLike) {
  return normalizeStaffRole(staff?.role) === 'cashier';
}

export function isManagerLikeStaff(staff: StaffLike) {
  return MANAGER_LIKE_ROLES.has(normalizeStaffRole(staff?.role));
}

export function canSeeAllKots(staff: StaffLike) {
  const role = normalizeStaffRole(staff?.role);
  return isManagerLikeStaff(staff) || KOT_QUEUE_ROLES.has(role);
}

export function isHandoverOrderStatus(status?: string | null) {
  return !!status && HANDOVER_ORDER_STATUSES.includes(status as (typeof HANDOVER_ORDER_STATUSES)[number]);
}

export function isActiveHotelOrderStatus(status?: string | null) {
  return !!status && ACTIVE_ORDER_STATUSES.includes(status as (typeof ACTIVE_ORDER_STATUSES)[number]);
}

export function isTableOccupyingOrderStatus(status?: string | null) {
  return !!status && TABLE_OCCUPYING_ORDER_STATUSES.includes(status as OrderStatus);
}

export function isUncheckedInReservationOrder(
  order?: Pick<HotelOrder, 'order_type' | 'checked_in_at' | 'table_id' | 'table_number'> | null
) {
  if (!order) return false;
  if (order.order_type !== 'reservation') return false;
  if (order.checked_in_at) return false;
  return !!(order.table_id || order.table_number);
}

export function getEffectiveHotelTableStatus(
  tableStatus?: HotelTableStatus | null,
  order?: Pick<HotelOrder, 'status' | 'order_type' | 'checked_in_at' | 'table_id' | 'table_number'> | null
) {
  if (order && isTableOccupyingOrderStatus(order.status) && !isUncheckedInReservationOrder(order)) {
    return 'occupied' as const;
  }

  return tableStatus || 'free';
}

export function isOrderOwnedByStaff(
  order: Pick<HotelOrder, 'waiter_id' | 'staff_id' | 'assigned_waiter_id'>,
  staffId?: string | null
) {
  if (!staffId) return false;
  return (
    order.waiter_id === staffId ||
    order.staff_id === staffId ||
    order.assigned_waiter_id === staffId
  );
}

export function canAccessHotelOrder(
  staff: StaffLike,
  order: Pick<HotelOrder, 'waiter_id' | 'staff_id' | 'assigned_waiter_id' | 'status'>
) {
  if (isManagerLikeStaff(staff)) return true;
  if (!staff?.staff_id) return false;

  if (isWaiterStaff(staff)) {
    return isOrderOwnedByStaff(order, staff.staff_id);
  }

  if (isCashierStaff(staff)) {
    return isHandoverOrderStatus(order.status);
  }

  if (canSeeAllKots(staff)) {
    return true;
  }

  return isOrderOwnedByStaff(order, staff.staff_id);
}

export function canManageHotelOrder(
  staff: StaffLike, 
  order: Pick<HotelOrder, 'waiter_id' | 'staff_id' | 'assigned_waiter_id' | 'status'>
) {
  // Managers can always manage, waiters can manage their own orders (including billed)
  return isManagerLikeStaff(staff) || 
    (isOrderOwnedByStaff(order, staff?.staff_id) && isWaiterStaff(staff));
}

export function canManageHotelTable(
  staff: StaffLike,
  order: Pick<HotelOrder, 'waiter_id' | 'staff_id' | 'assigned_waiter_id' | 'status'> | null | undefined
) {
  if (!order) return true;
  if (!isTableOccupyingOrderStatus(order.status)) return true;
  return canManageHotelOrder(staff, order);
}

export function getStoredActiveStaff(): ActiveStaff | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(ACTIVE_STAFF_SESSION_KEY);
    if (!raw) return null;
    return normalizeStoredActiveStaff(JSON.parse(raw) as ActiveStaff);
  } catch {
    return null;
  }
}

export function persistActiveStaff(staff: ActiveStaff | null) {
  if (typeof window === 'undefined') return;

  if (!staff) {
    window.localStorage.removeItem(ACTIVE_STAFF_SESSION_KEY);
    return;
  }

  window.localStorage.setItem(
    ACTIVE_STAFF_SESSION_KEY,
    JSON.stringify(normalizeStoredActiveStaff(staff))
  );
}

type ActiveStaffProfilePatch = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  allowed_hotel_routes?: string[] | null;
  is_active?: boolean | null;
};

export function syncPersistedActiveStaffFromProfile(staff: ActiveStaffProfilePatch | null | undefined) {
  if (!staff) {
    return null;
  }

  const current = getStoredActiveStaff();
  if (!current || current.staff_id !== staff.id) {
    return current;
  }

  const nextStaff =
    staff.is_active === false
      ? null
      : normalizeStoredActiveStaff({
          ...current,
          first_name: staff.first_name ?? current.first_name,
          last_name: staff.last_name ?? current.last_name,
          role: staff.role ?? current.role,
          allowed_hotel_routes: staff.allowed_hotel_routes ?? current.allowed_hotel_routes,
        });

  persistActiveStaff(nextStaff);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(ACTIVE_STAFF_UPDATED_EVENT, {
        detail: nextStaff,
      })
    );
  }

  return nextStaff;
}

export function getWaiterPosAccess(): WaiterPosAccessState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(WAITER_POS_ACCESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WaiterPosAccessState;
  } catch {
    return null;
  }
}

export function hasWaiterPosAccess(staffId?: string | null) {
  const access = getWaiterPosAccess();
  if (!access || !staffId) return false;
  return access.staffId === staffId;
}

export function grantWaiterPosAccess(access: Omit<WaiterPosAccessState, 'grantedAt'>) {
  if (typeof window === 'undefined') return;

  window.sessionStorage.setItem(
    WAITER_POS_ACCESS_KEY,
    JSON.stringify({
      ...access,
      grantedAt: Date.now(),
    } satisfies WaiterPosAccessState)
  );
}

export function clearWaiterPosAccess() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(WAITER_POS_ACCESS_KEY);
}

export async function clearHotelIsolationCache() {
  // Keep order/session/table data, only clear staff-specific data
  const tablesToKeep = ['hotel_orders', 'hotel_order_items', 'hotel_table_sessions', 'hotel_table_session_seats', 'hotel_table_payment_groups', 'hotel_table_payment_group_seats', 'hotel_tables'];
  await Promise.all(HOTEL_ISOLATION_CACHE_TABLES.filter(table => !tablesToKeep.includes(table)).map((table) => clearLocalTable(table)));
}

export function filterOrdersForStaff<T extends Pick<HotelOrder, 'waiter_id' | 'staff_id' | 'assigned_waiter_id' | 'status'>>(
  orders: T[],
  staff: StaffLike,
  filters?: { waiterId?: string; status?: string[] }
) {
  let filtered = [...orders];

  if (isWaiterStaff(staff) && staff?.staff_id) {
    filtered = filtered.filter((order) => isOrderOwnedByStaff(order, staff.staff_id));
  } else if (isCashierStaff(staff) && !isManagerLikeStaff(staff)) {
    filtered = filtered.filter((order) => isHandoverOrderStatus(order.status));
  }

  if (filters?.waiterId) {
    filtered = filtered.filter((order) => isOrderOwnedByStaff(order, filters.waiterId));
  }

  if (filters?.status?.length) {
    filtered = filtered.filter((order) => filters.status!.includes(order.status));
  }

  return filtered;
}

export function applyOrderQueryScope<TQuery extends { eq: Function; in: Function; or?: Function }>(
  query: TQuery,
  staff: StaffLike,
  filters?: { waiterId?: string; status?: string[] }
) {
  let scopedQuery: TQuery = query;

  if (isWaiterStaff(staff) && staff?.staff_id) {
    scopedQuery = (typeof scopedQuery.or === 'function'
      ? scopedQuery.or(
          `waiter_id.eq.${staff.staff_id},staff_id.eq.${staff.staff_id},assigned_waiter_id.eq.${staff.staff_id}`
        )
      : scopedQuery.eq('waiter_id', staff.staff_id)) as TQuery;
  } else if (filters?.waiterId) {
    scopedQuery = (typeof scopedQuery.or === 'function'
      ? scopedQuery.or(
          `waiter_id.eq.${filters.waiterId},staff_id.eq.${filters.waiterId},assigned_waiter_id.eq.${filters.waiterId}`
        )
      : scopedQuery.eq('waiter_id', filters.waiterId)) as TQuery;
  }

  if (isCashierStaff(staff) && !isManagerLikeStaff(staff)) {
    scopedQuery = scopedQuery.in('status', filters?.status?.length ? filters.status : [...HANDOVER_ORDER_STATUSES]);
  } else if (filters?.status?.length) {
    scopedQuery = scopedQuery.in('status', filters.status);
  }

  return scopedQuery;
}
