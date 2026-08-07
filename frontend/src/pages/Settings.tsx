import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SystemSettings } from "@/components/settings/SystemSettings";
import { StockSettings } from "@/components/settings/StockSettings";
import { POSSettings } from "@/components/settings/POSSettings";
import { ReceiptSettings } from "@/components/settings/ReceiptSettings";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { UserManagement } from "@/components/settings/UserManagement";
import { BackupSettings } from "@/components/settings/BackupSettings";
import { RolePermissionsEditor } from "@/components/settings/RolePermissionsEditor";
import { useAuth } from "@/contexts/AuthContext";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { canManageRoleAdministration } from "@/lib/permissions";
import {
  Settings as SettingsIcon,
  Package,
  ShoppingCart,
  Receipt,
  Palette,
  Bell,
  Users,
  Database,
  Shield,
} from "lucide-react";

export default function Settings() {
  const [activeTab, setActiveTab] = useState("system");
  const { userRole, userRoles } = useAuth();
  const { data: permissions } = useRolePermissions();
  
   const canManageRoles = canManageRoleAdministration(Array.isArray(userRoles) && userRoles.length > 0 ? userRoles : userRole, permissions);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your system configuration and preferences
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className={`grid w-full ${canManageRoles ? 'grid-cols-9' : 'grid-cols-8'}`}>
          <TabsTrigger value="system" className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
            <span className="hidden sm:inline">System</span>
          </TabsTrigger>
          <TabsTrigger value="stock" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Stock</span>
          </TabsTrigger>
          <TabsTrigger value="pos" className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">POS</span>
          </TabsTrigger>
          <TabsTrigger value="receipt" className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            <span className="hidden sm:inline">Receipt</span>
          </TabsTrigger>
          <TabsTrigger value="theme" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">Theme</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Alerts</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Users</span>
          </TabsTrigger>
          {canManageRoles && (
            <TabsTrigger value="permissions" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Permissions</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="backup" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            <span className="hidden sm:inline">Backup</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
              <CardDescription>
                Configure basic system settings and company information
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SystemSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stock" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Stock Management Settings</CardTitle>
              <CardDescription>
                Configure stock thresholds, alerts, and inventory behavior
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StockSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Point of Sale Settings</CardTitle>
              <CardDescription>
                Configure POS behavior, payment methods, and customer display
              </CardDescription>
            </CardHeader>
            <CardContent>
              <POSSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receipt" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Receipt Design Settings</CardTitle>
              <CardDescription>
                Customize receipt layout, text, and branding
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReceiptSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="theme" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Theme & UI Settings</CardTitle>
              <CardDescription>
                Customize the appearance and theme of your application
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>
                Configure alerts and notification preferences
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>User Management</CardTitle>
              <CardDescription>
                Manage user roles, permissions, and access control
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UserManagement />
            </CardContent>
          </Card>
        </TabsContent>

        {canManageRoles && (
          <TabsContent value="permissions" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Role Permissions</CardTitle>
                <CardDescription>
                  Customize which pages each role can access in POS and Restaurant modes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RolePermissionsEditor />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="backup" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Backup & Data Settings</CardTitle>
              <CardDescription>
                Configure data backup, export, and retention policies
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BackupSettings />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
