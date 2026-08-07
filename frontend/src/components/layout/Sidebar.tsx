import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  BarChart3,
  Receipt,
  UtensilsCrossed,
  ChefHat,
  Wine,
  Clock,
  ClipboardList,
  HandCoins,
  Building,
  UserCheck,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyProfile } from "@/hooks/useSettings";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { isStaffShellAccount } from "@/lib/hotelAccess";
import { filterNavigationByAccess, hasFullAccessRole, UserRole, getRoleDisplayName, setCachedPermissions } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { useEffect } from "react";

const restaurantNavigation = [
  { name: "Dashboard",         href: "/restaurant/dashboard",    icon: LayoutDashboard },
  { name: "Point of Sale",     href: "/restaurant/pos",          icon: ShoppingCart },
  { name: "Tables",            href: "/restaurant/tables",       icon: ClipboardList },
  { name: "Menu",              href: "/restaurant/menu",         icon: UtensilsCrossed },
  { name: "Inventory",         href: "/restaurant/inventory",    icon: Package },
  { name: "Kitchen Display",   href: "/restaurant/kitchen",      icon: ChefHat },
  { name: "Bar Display",       href: "/restaurant/bar",          icon: Wine },
  { name: "Billing",           href: "/restaurant/billing",      icon: Receipt },
  { name: "Staff",             href: "/restaurant/staff",        icon: Building },
  { name: "Customers",         href: "/customers",               icon: Users },
  { name: "Attendance",        href: "/restaurant/attendance",   icon: UserCheck },
  { name: "Shifts",            href: "/restaurant/shifts",       icon: Clock },
  { name: "Shift Report",      href: "/restaurant/shift-report", icon: ClipboardList },
  { name: "Finance & Payroll", href: "/restaurant/finance",      icon: HandCoins },
  { name: "Reports",           href: "/restaurant/reports",      icon: BarChart3 },
  { name: "Settings",          href: "/restaurant/settings",     icon: Settings },
];

export function Sidebar() {
  const { user, userRole, userRoles } = useAuth();
  const { data: companyProfile } = useCompanyProfile();
  const { activeStaff } = useStaffSession();
  const { data: rolePermissions } = useRolePermissions();
  const isSystemAdmin = hasFullAccessRole(Array.isArray(userRoles) && userRoles.length > 0 ? userRoles : userRole);
  const isStaffShellUser = isStaffShellAccount(user?.email);
  const usesStaffScopedAccess = !!activeStaff && (isStaffShellUser || !isSystemAdmin);

  useEffect(() => {
    if (rolePermissions) {
      setCachedPermissions(rolePermissions);
    }
  }, [rolePermissions]);

  const title = companyProfile?.company_name || "Restaurant";
  const allowedRoutes = usesStaffScopedAccess ? (activeStaff?.allowed_hotel_routes || []) : [];
  const effectiveRole = usesStaffScopedAccess ? (activeStaff?.role || userRole) : userRole;
  const effectiveRoles = usesStaffScopedAccess ? [activeStaff?.role || userRole].filter(Boolean) : userRoles;

  const navigation = filterNavigationByAccess(
    restaurantNavigation,
    effectiveRoles as UserRole[],
    rolePermissions,
    allowedRoutes
  );

  return (
    <div className="w-60 md:w-72 bg-card border-r border-border h-full shadow-premium-lg flex flex-col">
      <div className="p-5 md:p-7 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl gradient-primary flex items-center justify-center shadow-premium">
            <UtensilsCrossed className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-extrabold tracking-tight text-gradient-primary">{title}</h2>
            <p className="text-xs md:text-sm text-muted-foreground font-medium">Restaurant Management</p>
          </div>
        </div>
        {effectiveRole && (
          <Badge variant="secondary" className="mt-4 text-xs font-bold px-3 py-1.5">
            {getRoleDisplayName(effectiveRole as UserRole)}
          </Badge>
        )}
      </div>

      <nav className="flex-1 mt-4 md:mt-6 px-3 md:px-4 overflow-y-auto">
        <ul className="space-y-1.5">
          {navigation.map((item) => (
            <li key={item.name}>
              <NavLink
                to={item.href}
                className={({ isActive }) =>
                  cn(
                    "flex items-center px-4 md:px-5 py-3.5 md:py-4 text-sm font-semibold rounded-xl transition-all duration-200 ease-in-out",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-premium-lg shadow-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:shadow-sm"
                  )
                }
              >
                <item.icon className="h-5 w-5 md:h-5.5 md:w-5.5 mr-3 md:mr-4" />
                <span className="text-sm md:text-base tracking-tight">{item.name}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
