import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient } from "@/integrations/supabase/client";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { isAdminRole } from "@/lib/permissions";
import { 
  Shield, 
  Users, 
  Settings, 
  TrendingUp,
  DollarSign,
  Package,
  ShoppingCart,
  BarChart3,
  CreditCard,
  AlertTriangle,
  Activity,
  Database,
  Lock,
  UserCog,
  FileText,
  Eye,
  CheckCircle,
  XCircle
} from "lucide-react";
import { UserManagement } from "@/components/settings/UserManagement";

interface SystemStats {
  totalUsers: number;
  totalProducts: number;
  totalSales: number;
  totalRevenue: number;
  totalLoans: number;
  activeLoans: number;
  overdueLoans: number;
  todayRevenue: number;
  weekRevenue: number;
  monthRevenue: number;
}

export default function OwnerDashboard() {
  const { formatCurrency, companyProfile } = useSettingsContext();
  const { user, userRole } = useAuth();
  const navigate = useNavigate();
  const { data: permissions } = useRolePermissions();
  const [stats, setStats] = useState<SystemStats>({
    totalUsers: 0,
    totalProducts: 0,
    totalSales: 0,
    totalRevenue: 0,
    totalLoans: 0,
    activeLoans: 0,
    overdueLoans: 0,
    todayRevenue: 0,
    weekRevenue: 0,
    monthRevenue: 0,
  });
  const [loading, setLoading] = useState(true);
  
  const isAdmin = isAdminRole(userRole, permissions);

  useEffect(() => {
    // Redirect if not admin (database-driven check)
    if (userRole && permissions && !isAdminRole(userRole, permissions)) {
      navigate('/');
    }
  }, [userRole, permissions, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchOwnerStats();
    }
  }, [isAdmin]);

  const fetchOwnerStats = async () => {
    try {
      // Get total users
      const { data: usersData } = await apiClient
        .from('user_roles')
        .select('user_id', { count: 'exact', head: true });

      // Get total products
      const { count: productCount } = await apiClient
        .from('products')
        .select('*', { count: 'exact', head: true });

      // Get total sales
      const { count: salesCount } = await apiClient
        .from('sales')
        .select('*', { count: 'exact', head: true });

      // Get total revenue
      const { data: revenueData } = await apiClient
        .from('sales')
        .select('final_amount');
      const totalRevenue = revenueData?.reduce((sum, sale) => sum + Number(sale.final_amount), 0) || 0;

      // Get loans stats
      const { data: loansData } = await apiClient
        .from('customer_loans')
        .select('status, total_amount');
      
      const totalLoans = loansData?.length || 0;
      const activeLoans = loansData?.filter(l => l.status === 'active').length || 0;
      const overdueLoans = loansData?.filter(l => l.status === 'overdue').length || 0;

      // Get today's revenue
      const today = new Date().toISOString().split('T')[0];
      const { data: todayData } = await apiClient
        .from('sales')
        .select('final_amount')
        .gte('sale_date', today);
      const todayRevenue = todayData?.reduce((sum, sale) => sum + Number(sale.final_amount), 0) || 0;

      // Get this week's revenue
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data: weekData } = await apiClient
        .from('sales')
        .select('final_amount')
        .gte('sale_date', weekAgo.toISOString().split('T')[0]);
      const weekRevenue = weekData?.reduce((sum, sale) => sum + Number(sale.final_amount), 0) || 0;

      // Get this month's revenue
      const monthStart = new Date();
      monthStart.setDate(1);
      const { data: monthData } = await apiClient
        .from('sales')
        .select('final_amount')
        .gte('sale_date', monthStart.toISOString().split('T')[0]);
      const monthRevenue = monthData?.reduce((sum, sale) => sum + Number(sale.final_amount), 0) || 0;

      setStats({
        totalUsers: usersData?.length || 0,
        totalProducts: productCount || 0,
        totalSales: salesCount || 0,
        totalRevenue,
        totalLoans,
        activeLoans,
        overdueLoans,
        todayRevenue,
        weekRevenue,
        monthRevenue,
      });
    } catch (error) {
      console.error('Error fetching owner stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary animate-pulse" />
          <h1 className="text-3xl font-bold">Loading Owner Dashboard...</h1>
        </div>
      </div>
    );
  }

  if (userRole !== 'admin') {
    return null;
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Owner Dashboard</h1>
            <p className="text-muted-foreground">Full system control & monitoring</p>
          </div>
        </div>
        <Badge variant="default" className="text-sm px-4 py-2">
          <Lock className="w-4 h-4 mr-2" />
          Admin Access
        </Badge>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">
            <Activity className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users className="h-4 w-4 mr-2" />
            Users
          </TabsTrigger>
          <TabsTrigger value="system">
            <Database className="h-4 w-4 mr-2" />
            System
          </TabsTrigger>
          <TabsTrigger value="controls">
            <Settings className="h-4 w-4 mr-2" />
            Controls
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Revenue Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-success/50 bg-success/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-success" />
                  Today's Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-success">
                  {formatCurrency(stats.todayRevenue)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  This Week
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-primary">
                  {formatCurrency(stats.weekRevenue)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-accent/50 bg-accent/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-accent-foreground" />
                  This Month
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-accent-foreground">
                  {formatCurrency(stats.monthRevenue)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* System Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalUsers}</div>
                <p className="text-xs text-muted-foreground">System users</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Products</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalProducts}</div>
                <p className="text-xs text-muted-foreground">In inventory</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalSales}</div>
                <p className="text-xs text-muted-foreground">All time</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(stats.totalRevenue)}</div>
                <p className="text-xs text-muted-foreground">Lifetime</p>
              </CardContent>
            </Card>
          </div>

          {/* Loans Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Loans Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-primary/10 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{stats.totalLoans}</div>
                  <p className="text-sm text-muted-foreground">Total Loans</p>
                </div>
                <div className="text-center p-4 bg-success/10 rounded-lg">
                  <div className="text-2xl font-bold text-success">{stats.activeLoans}</div>
                  <p className="text-sm text-muted-foreground">Active</p>
                </div>
                <div className="text-center p-4 bg-warning/10 rounded-lg">
                  <div className="text-2xl font-bold text-warning">{stats.overdueLoans}</div>
                  <p className="text-sm text-muted-foreground">Overdue</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5" />
                User Management
              </CardTitle>
              <CardDescription>
                Manage user accounts, roles, and permissions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UserManagement />
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Tab */}
        <TabsContent value="system" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Database Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Connection</span>
                  <Badge variant="default" className="bg-success">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Active
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Products Table</span>
                  <Badge variant="outline">{stats.totalProducts} records</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Sales Table</span>
                  <Badge variant="outline">{stats.totalSales} records</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Users Table</span>
                  <Badge variant="outline">{stats.totalUsers} records</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Company Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {companyProfile ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Company Name</span>
                      <span className="text-sm font-medium">{companyProfile.company_name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Phone</span>
                      <span className="text-sm font-medium">{companyProfile.phone || 'N/A'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Email</span>
                      <span className="text-sm font-medium">{companyProfile.email || 'N/A'}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No company profile configured</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Controls Tab */}
        <TabsContent value="controls" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/products')}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  Product Management
                </CardTitle>
                <CardDescription>Add, edit, and manage all products</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  Manage Products
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/stock')}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Stock Management
                </CardTitle>
                <CardDescription>Monitor and control inventory levels</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  Manage Stock
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/reports')}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Reports & Analytics
                </CardTitle>
                <CardDescription>View detailed business reports</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  View Reports
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/settings')}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-primary" />
                  System Settings
                </CardTitle>
                <CardDescription>Configure system preferences</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  Open Settings
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/loans')}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                  Loan Management
                </CardTitle>
                <CardDescription>Track and manage customer loans</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  Manage Loans
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/sales')}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-primary" />
                  Sales History
                </CardTitle>
                <CardDescription>View all sales transactions</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  View Sales
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
