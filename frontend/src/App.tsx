import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { SettingsProvider } from "./contexts/SettingsContext";
import { AuthProvider } from "./contexts/AuthContext";
import { StaffSessionProvider } from "@/contexts/StaffSessionContext";
import { apiClient, safeApiClientCall, canUseApiClientSync, getIsBackendReachable } from "./integrations/supabase/client";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { useHotelOrdersRealtime } from "./hooks/useHotelOrders";
import { ConnectionBanner } from "./components/common/ConnectionBanner";
import { lazy, Suspense, useEffect, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { getStaffRedirectCandidates, isStaffShellAccount, resolveRoleLandingRoute } from "@/lib/hotelAccess";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { hasFullAccessRole, hasNavigationItemAccess, hasRouteAccessWithData } from "@/lib/permissions";
import React from "react";

class GlobalErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null; errorInfo: React.ErrorInfo | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-50 min-h-screen">
          <h1 className="text-red-800 font-bold text-lg">App Error</h1>
          <pre className="mt-4 bg-red-100 p-4 rounded text-xs overflow-auto text-red-800">
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Auth & Shared pages
const Auth = lazy(() => import("./pages/Auth"));
const AdminSetup = lazy(() => import("./pages/AdminSetup"));
const Customers = lazy(() => import("./pages/Customers"));
const Products = lazy(() => import("./pages/Products"));
const StockManagement = lazy(() => import("./pages/StockManagement"));
const SalesHistory = lazy(() => import("./pages/SalesHistory"));
const LoanManagement = lazy(() => import("./pages/LoanManagement"));
const Scanner = lazy(() => import("./pages/Scanner"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Restaurant pages
const RestaurantDashboard = lazy(() => import("./pages/hotel/RestaurantDashboard"));
const HotelTables = lazy(() => import("./pages/hotel/HotelTables"));
const HotelBilling = lazy(() => import("./pages/hotel/HotelBilling"));
const HotelServiceMenu = lazy(() => import("./pages/hotel/HotelServiceMenu"));
const HotelInventory = lazy(() => import("./pages/hotel/HotelInventory"));
const HotelInventoryLocation = lazy(() => import("./pages/hotel/HotelInventoryLocation"));
const HotelPOS = lazy(() => import("./pages/hotel/HotelPOS"));
const WaiterPOS = lazy(() => import("./pages/hotel/WaiterPOS"));
const KitchenDisplay = lazy(() => import("./pages/hotel/KitchenDisplay"));
const BarDisplay = lazy(() => import("./pages/hotel/BarDisplay"));
const HotelStaff = lazy(() => import("./pages/hotel/HotelStaff"));
const HotelShifts = lazy(() => import("./pages/hotel/HotelShifts"));
const ShiftReport = lazy(() => import("./pages/hotel/ShiftReport"));
const HotelFinance = lazy(() => import("./pages/hotel/HotelFinance"));
const HotelReports = lazy(() => import("./pages/hotel/HotelReports"));
const HotelSettings = lazy(() => import("./pages/hotel/HotelSettings"));

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-[#020617]">
    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const getBusinessDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getMidnightIso = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).toISOString();

const getWorkedHours = (start?: string | null, end?: string | null) => {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return 0;
  return Number((((endMs - startMs) / 1000 / 60 / 60) as number).toFixed(2));
};

async function closePreviousDayWork() {
  if (!canUseApiClientSync()) {
    return;
  }

  const now = new Date();
  const today = getBusinessDate(now);
  const midnightIso = getMidnightIso(now);
  let changed = false;

  const openAttendance = await safeApiClientCall<Array<{ id: string; check_in_time: string | null; notes: string | null }>>(
    apiClient
      .from("hotel_staff_attendance")
      .select("id, check_in_time, notes")
      .eq("is_active", true)
      .lt("date", today) as any
  );

  for (const entry of openAttendance || []) {
    const updatedAttendance = await safeApiClientCall(
      apiClient
        .from("hotel_staff_attendance")
        .update({
          check_out_time: midnightIso,
          status: "completed",
          is_active: false,
          worked_hours: getWorkedHours(entry.check_in_time, midnightIso),
          notes: entry.notes
            ? `${entry.notes}\nAuto-closed at 00:00 for a new day.`
            : "Auto-closed at 00:00 for a new day.",
        })
        .eq("id", entry.id)
        .select("id") as any
    );

    changed = changed || !!updatedAttendance;
  }

  const openShifts = await safeApiClientCall<Array<{ id: string; closing_notes: string | null }>>(
    apiClient
      .from("hotel_staff_shifts")
      .select("id, closing_notes")
      .is("closed_at", null)
      .lt("opened_at", midnightIso) as any
  );

  for (const shift of openShifts || []) {
    const updatedShift = await safeApiClientCall(
      apiClient
        .from("hotel_staff_shifts")
        .update({
          closed_at: midnightIso,
          status: "CLOSED",
          closing_notes: shift.closing_notes
            ? `${shift.closing_notes}\nAutomatically closed at 00:00 for day-end.`
            : "Automatically closed at 00:00 for day-end.",
        })
        .eq("id", shift.id)
        .select("id") as any
    );

    changed = changed || !!updatedShift;
  }

  if (changed) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["hotel-attendance"] }),
      queryClient.invalidateQueries({ queryKey: ["hotel-shifts"] }),
    ]);
  }
}

const GlobalRealtime = () => {
  useHotelOrdersRealtime();

  useEffect(() => {
    let midnightTimer: number | null = null;

    const scheduleMidnightClose = () => {
      const current = new Date();
      const nextMidnight = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate() + 1,
        0, 0, 1, 0
      );

      midnightTimer = window.setTimeout(async () => {
        try {
          if (getIsBackendReachable()) {
            await closePreviousDayWork();
          }
        } catch (error) {
          console.error("Failed to auto-close previous day work:", error);
        } finally {
          scheduleMidnightClose();
        }
      }, nextMidnight.getTime() - current.getTime());
    };

    if (getIsBackendReachable()) {
      closePreviousDayWork().catch((error) => {
        console.warn("Failed to reconcile previous day work:", error.message || "Network issue");
      });
    }
    scheduleMidnightClose();

    return () => {
      if (midnightTimer) window.clearTimeout(midnightTimer);
    };
  }, []);

  return null;
};

const RootRedirect = () => {
  const { user, loading, landingPage, userRole, userRoles } = useAuth();
  const { activeStaff, isStaffLoggedIn, isBootstrapping, logoutStaff } = useStaffSession();
  const { data: rolePermissions, isLoading: permissionsLoading } = useRolePermissions();
  const isSystemAdmin = hasFullAccessRole(Array.isArray(userRoles) && userRoles.length > 0 ? userRoles : userRole);
  const isStaffShellUser = isStaffShellAccount(user?.email);
  const usesStaffScopedAccess = !!activeStaff && (isStaffShellUser || !isSystemAdmin);
  const effectiveRole = usesStaffScopedAccess ? activeStaff?.role || userRole : userRole;
  const effectiveRoles = usesStaffScopedAccess
    ? [activeStaff?.role || userRole].filter(Boolean)
    : (Array.isArray(userRoles) ? userRoles : []);
  const allowedHotelRoutes = usesStaffScopedAccess ? (activeStaff?.allowed_hotel_routes || []) : [];
  const accessibleStaffRoute = activeStaff
    ? getStaffRedirectCandidates(activeStaff).find((path) =>
        hasNavigationItemAccess(
          path,
          effectiveRoles,
          permissionsLoading ? null : (rolePermissions || null),
          allowedHotelRoutes
        )
      ) || null
    : null;

  useEffect(() => {
    if (!(import.meta.env.DEV && import.meta.env.VITE_DEBUG_AUTH_FLOW === 'true')) {
      return;
    }

    if (loading || isBootstrapping) {
      return;
    }

    console.info('[RootRedirect] Evaluated', {
      userId: user?.id || null,
      email: user?.email || null,
      userRole,
      landingPage,
      isSystemAdmin,
      isStaffLoggedIn,
      activeStaffId: activeStaff?.staff_id || null,
      activeStaffRole: activeStaff?.role || null,
      accessibleStaffRoute,
    });
  }, [accessibleStaffRoute, activeStaff?.role, activeStaff?.staff_id, isBootstrapping, isStaffLoggedIn, isSystemAdmin, landingPage, loading, user?.email, user?.id, userRole]);

  useEffect(() => {
    if (loading || isBootstrapping || !activeStaff) {
      return;
    }

    if (accessibleStaffRoute) {
      return;
    }

    if (isStaffShellUser || (!isSystemAdmin && isStaffLoggedIn)) {
      logoutStaff();
    }
  }, [accessibleStaffRoute, activeStaff, isBootstrapping, isStaffLoggedIn, isStaffShellUser, isSystemAdmin, loading, logoutStaff]);

  if (loading) return <LoadingFallback />;
  if (isBootstrapping) return <LoadingFallback />;
  if (!user) return <Navigate to="/auth" replace />;

  if (isStaffShellUser && activeStaff && accessibleStaffRoute) {
    return <Navigate to={accessibleStaffRoute} replace />;
  }

  if (!isSystemAdmin && isStaffLoggedIn && activeStaff && accessibleStaffRoute) {
    return <Navigate to={accessibleStaffRoute} replace />;
  }

  if (isStaffShellUser) {
    return <Navigate to="/restaurant/dashboard" replace />;
  }

  const fallbackLandingPage = hasRouteAccessWithData(
    landingPage || resolveRoleLandingRoute(userRole),
    userRoles,
    permissionsLoading ? null : (rolePermissions || null)
  )
    ? (landingPage || resolveRoleLandingRoute(userRole))
    : '/auth';

  return <Navigate to={fallbackLandingPage} replace />;
};

const App = () => (
  <GlobalErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <SettingsProvider>
        <StaffSessionProvider>
          <TooltipProvider>
            <GlobalRealtime />
            <HashRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
              <Suspense fallback={<LoadingFallback />}>
                <Routes>
                  {/* Auth */}
                  <Route path="/auth" element={<Auth />} />

                  {/* Admin Setup */}
                  {(import.meta.env.DEV || import.meta.env.VITE_ADMIN_SETUP_SECRET) && (
                    <Route path="/admin-setup" element={<AdminSetup />} />
                  )}

                  {/* Default: redirect based on role */}
                  <Route path="/" element={<RootRedirect />} />

                  {/* Restaurant Routes */}
                  <Route path="/restaurant/dashboard" element={<ProtectedRoute><RestaurantDashboard /></ProtectedRoute>} />
                  <Route path="/restaurant/pos" element={<ProtectedRoute><HotelPOS /></ProtectedRoute>} />
                  <Route path="/restaurant/waiter-pos" element={<ProtectedRoute><WaiterPOS /></ProtectedRoute>} />
                  <Route path="/restaurant/tables" element={<ProtectedRoute><HotelTables /></ProtectedRoute>} />
                  <Route path="/restaurant/menu" element={<ProtectedRoute><HotelServiceMenu /></ProtectedRoute>} />
                  <Route path="/restaurant/inventory" element={<ProtectedRoute><HotelInventory /></ProtectedRoute>} />
                  <Route path="/restaurant/inventory/:location" element={<ProtectedRoute><HotelInventoryLocation /></ProtectedRoute>} />
                  <Route path="/restaurant/kitchen" element={<ProtectedRoute><KitchenDisplay /></ProtectedRoute>} />
                  <Route path="/restaurant/bar" element={<ProtectedRoute><BarDisplay /></ProtectedRoute>} />
                  <Route path="/restaurant/billing" element={<ProtectedRoute><HotelBilling /></ProtectedRoute>} />
                  <Route path="/restaurant/staff" element={<ProtectedRoute><HotelStaff /></ProtectedRoute>} />
                  <Route path="/restaurant/attendance" element={<ProtectedRoute><HotelStaff defaultTab="attendance" attendanceOnly /></ProtectedRoute>} />
                  <Route path="/restaurant/shifts" element={<ProtectedRoute><HotelShifts /></ProtectedRoute>} />
                  <Route path="/restaurant/shift-report" element={<ProtectedRoute><ShiftReport /></ProtectedRoute>} />
                  <Route path="/restaurant/finance" element={<ProtectedRoute><HotelFinance /></ProtectedRoute>} />
                  <Route path="/restaurant/reports" element={<ProtectedRoute><HotelReports /></ProtectedRoute>} />
                  <Route path="/restaurant/settings" element={<ProtectedRoute><HotelSettings /></ProtectedRoute>} />
                  <Route path="/restaurant/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
                  <Route path="/restaurant/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
                  <Route path="/restaurant/stock" element={<ProtectedRoute><StockManagement /></ProtectedRoute>} />
                  <Route path="/restaurant/sales" element={<ProtectedRoute><SalesHistory /></ProtectedRoute>} />
                  <Route path="/restaurant/loans" element={<ProtectedRoute><LoanManagement /></ProtectedRoute>} />

                  {/* Shared/Retail Routes */}
                  <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
                  <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
                  <Route path="/stock" element={<ProtectedRoute><StockManagement /></ProtectedRoute>} />
                  <Route path="/sales" element={<ProtectedRoute><SalesHistory /></ProtectedRoute>} />
                  <Route path="/loans" element={<ProtectedRoute><LoanManagement /></ProtectedRoute>} />
                  <Route path="/scanner" element={<ProtectedRoute><Scanner /></ProtectedRoute>} />

                  {/* Legacy redirects — old /hotel/* links still work */}
                  <Route path="/hotel/restaurant-dashboard" element={<Navigate to="/restaurant/dashboard" replace />} />
                  <Route path="/hotel/pos" element={<Navigate to="/restaurant/pos" replace />} />
                  <Route path="/hotel/tables" element={<Navigate to="/restaurant/tables" replace />} />
                  <Route path="/hotel/service-menu" element={<Navigate to="/restaurant/menu" replace />} />
                  <Route path="/hotel/inventory" element={<Navigate to="/restaurant/inventory" replace />} />
                  <Route path="/hotel/kitchen" element={<Navigate to="/restaurant/kitchen" replace />} />
                  <Route path="/hotel/bar" element={<Navigate to="/restaurant/bar" replace />} />
                  <Route path="/hotel/billing" element={<Navigate to="/restaurant/billing" replace />} />
                  <Route path="/hotel/staff" element={<Navigate to="/restaurant/staff" replace />} />
                  <Route path="/hotel/attendance" element={<Navigate to="/restaurant/attendance" replace />} />
                  <Route path="/hotel/shifts" element={<Navigate to="/restaurant/shifts" replace />} />
                  <Route path="/hotel/shift-report" element={<Navigate to="/restaurant/shift-report" replace />} />
                  <Route path="/hotel/finance" element={<Navigate to="/restaurant/finance" replace />} />
                  <Route path="/hotel/reports" element={<Navigate to="/restaurant/reports" replace />} />
                  <Route path="/hotel/settings" element={<Navigate to="/restaurant/settings" replace />} />
                  <Route path="/hotel/customers" element={<Navigate to="/restaurant/customers" replace />} />

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </HashRouter>
          </TooltipProvider>
        </StaffSessionProvider>
      </SettingsProvider>
    </AuthProvider>
  </QueryClientProvider>
  </GlobalErrorBoundary>
);

export default App;
