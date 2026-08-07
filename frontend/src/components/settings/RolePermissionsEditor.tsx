import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Loader2, Shield, Save, RotateCcw, Plus, Trash2, UserCog } from "lucide-react";
import { useRolePermissions, useUpdateRolePermissions, useCreateRole, useDeleteRole, availableHotelRoutes, RolePermission } from "@/hooks/useRolePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { canManageRoleAdministration } from "@/lib/permissions";
import { getIconComponent, getRoleColorClass, getBadgeVariant } from "@/lib/roleHelpers";
import { toast } from "sonner";
import { apiClient } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const iconOptions = [
  { value: 'Shield', label: 'Shield', icon: Shield },
  { value: 'UserCog', label: 'User Cog', icon: UserCog },
];

const colorOptions = [
  { value: 'default', label: 'Default', className: 'bg-muted' },
  { value: 'destructive', label: 'Red', className: 'bg-destructive' },
  { value: 'secondary', label: 'Blue', className: 'bg-blue-500' },
  { value: 'success', label: 'Green', className: 'bg-green-500' },
  { value: 'warning', label: 'Orange', className: 'bg-orange-500' },
  { value: 'purple', label: 'Purple', className: 'bg-purple-500' },
];

export function RolePermissionsEditor() {
  const { userRole, userRoles } = useAuth();
  const { data: permissions, isLoading } = useRolePermissions();
  const updatePermissions = useUpdateRolePermissions();
  const createRole = useCreateRole();
  const deleteRole = useDeleteRole();
  const queryClient = useQueryClient();
  const [editedPermissions, setEditedPermissions] = useState<Record<string, { hotel_routes: string[]; description: string | null; landing_page: string | null }>>({});
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', description: '', color: 'default', icon: 'Shield' });

  const canManageRoles = canManageRoleAdministration(Array.isArray(userRoles) && userRoles.length > 0 ? userRoles : userRole, permissions);

  if (!canManageRoles) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Only managers and administrators can manage role permissions.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const getCurrentRole = (role: string): RolePermission | undefined => {
    return permissions?.find(p => p.role === role);
  };

  const getEditedRole = (role: string) => {
    return editedPermissions[role];
  };

  const getRoleHotelRoutes = (role: string) => {
    const edited = getEditedRole(role);
    if (edited) return edited.hotel_routes;
    return getCurrentRole(role)?.hotel_routes || [];
  };

  const handleRouteToggle = (role: string, route: string) => {
    const currentRoutes = getRoleHotelRoutes(role);
    const newRoutes = currentRoutes.includes(route)
      ? currentRoutes.filter(r => r !== route)
      : [...currentRoutes, route];
    
    setEditedPermissions(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        hotel_routes: newRoutes,
        description: prev[role]?.description ?? getCurrentRole(role)?.description ?? null,
        landing_page: prev[role]?.landing_page ?? getCurrentRole(role)?.landing_page ?? null,
      },
    }));
  };

  const handleLandingPageChange = (role: string, landingPage: string) => {
    setEditedPermissions(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        hotel_routes: prev[role]?.hotel_routes ?? getCurrentRole(role)?.hotel_routes ?? [],
        description: prev[role]?.description ?? getCurrentRole(role)?.description ?? null,
        landing_page: landingPage,
      },
    }));
  };

  const handleDescriptionChange = (role: string, description: string) => {
    setEditedPermissions(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        hotel_routes: prev[role]?.hotel_routes ?? getCurrentRole(role)?.hotel_routes ?? [],
        description: description || null,
        landing_page: prev[role]?.landing_page ?? getCurrentRole(role)?.landing_page ?? null,
      },
    }));
  };

  const handleSave = async (role: string) => {
    const roleData = getCurrentRole(role);
    if (!roleData) return;
    const edited = getEditedRole(role);
    if (!edited) return;

    try {
      // First update role_permissions
      const { error: roleError } = await apiClient
        .from('role_permissions')
        .update({
          hotel_routes: edited.hotel_routes,
          description: edited.description,
          landing_page: edited.landing_page,
          updated_at: new Date().toISOString(),
        })
        .eq('role', role)
        .select()
        .single();
      
      if (roleError) throw roleError;

      // Now update all hotel_staff with this role
      const { error: staffError } = await apiClient
        .from('hotel_staff')
        .update({ allowed_hotel_routes: edited.hotel_routes })
        .eq('role', role);

      if (staffError) throw staffError;

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
      queryClient.invalidateQueries({ queryKey: ['hotel-staff'] });

      // Clear edited state
      setEditedPermissions(prev => {
        const newState = { ...prev };
        delete newState[role];
        return newState;
      });
      
      toast.success('Role permissions updated successfully!');
    } catch (error: any) {
      toast.error(`Error updating role: ${error.message}`);
    }
  };

  const handleReset = (role: string) => {
    setEditedPermissions(prev => {
      const newState = { ...prev };
      delete newState[role];
      return newState;
    });
  };

  const hasChanges = (role: string): boolean => {
    return !!editedPermissions[role];
  };

  const handleCreateRole = async () => {
    if (!newRole.name.trim()) return;
    
    await createRole.mutateAsync({
      name: newRole.name.toLowerCase().trim(),
      description: newRole.description || undefined,
      color: newRole.color,
      icon: newRole.icon,
      hotel_routes: [],
    });
    
    setShowCreateDialog(false);
    setNewRole({ name: '', description: '', color: 'default', icon: 'Shield' });
  };

  const handleDeleteRole = async (roleName: string) => {
    await deleteRole.mutateAsync(roleName);
  };

  const systemRoles = permissions?.filter(p => p.is_system) || [];
  const customRoles = permissions?.filter(p => !p.is_system) || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Role Permissions Editor</h3>
          <p className="text-sm text-muted-foreground">
            Customize which pages each role can access
          </p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Custom Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Custom Role</DialogTitle>
              <DialogDescription>
                Create a new role with customizable permissions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="role-name">Role Name</Label>
                <Input
                  id="role-name"
                  placeholder="e.g., barista, supervisor"
                  value={newRole.name}
                  onChange={(e) => setNewRole(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-description">Description (optional)</Label>
                <Textarea
                  id="role-description"
                  placeholder="Describe the purpose of this role..."
                  value={newRole.description}
                  onChange={(e) => setNewRole(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Icon</Label>
                  <Select
                    value={newRole.icon}
                    onValueChange={(value) => setNewRole(prev => ({ ...prev, icon: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {iconOptions.map((opt) => {
                        const IconComp = opt.icon;
                        return (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex items-center gap-2">
                              <IconComp className="h-4 w-4" />
                              {opt.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <Select
                    value={newRole.color}
                    onValueChange={(value) => setNewRole(prev => ({ ...prev, color: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {colorOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <div className={`h-3 w-3 rounded-full ${opt.className}`} />
                            {opt.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreateRole} 
                disabled={!newRole.name.trim() || createRole.isPending}
              >
                {createRole.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Role
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* System Roles */}
      <div>
        <h4 className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
          <Shield className="h-4 w-4" />
          System Roles
        </h4>
        <Accordion type="multiple" className="space-y-2">
          {systemRoles.map((perm) => {
            const currentRoutes = getRoleHotelRoutes(perm.role);
            const Icon = getIconComponent(perm.icon);
            const colorClass = getRoleColorClass(perm.color);
            const isAdmin = perm.role === 'admin';

            return (
              <AccordionItem key={perm.role} value={perm.role} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3">
                    <Icon className={`h-5 w-5 ${colorClass}`} />
                    <span className="font-medium capitalize">{perm.role}</span>
                    <Badge variant={getBadgeVariant(perm.color)}>{perm.role}</Badge>
                    <Badge variant="secondary" className="text-xs">System</Badge>
                    {hasChanges(perm.role) && (
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                        Unsaved
                      </Badge>
                    )}
                    <span className="text-sm text-muted-foreground ml-2">
                      ({currentRoutes.length} routes)
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="py-4 space-y-4">
                    {perm.description && (
                      <p className="text-sm text-muted-foreground mb-4">{perm.description}</p>
                    )}

                    {/* Landing Page Selector */}
                    <div className="space-y-2 mb-4">
                      <Label>Landing Page</Label>
                      <Select
                        value={editedPermissions[perm.role]?.landing_page ?? perm.landing_page ?? ''}
                        onValueChange={(val) => handleLandingPageChange(perm.role, val)}
                        disabled={isAdmin}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a landing page" />
                        </SelectTrigger>
                        <SelectContent>
                          {currentRoutes.map(path => {
                            const routeInfo = availableHotelRoutes.find(r => r.path === path);
                            return (
                              <SelectItem key={path} value={path}>
                                {routeInfo?.label || path}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Description Field */}
                    <div className="space-y-2 mb-4">
                      <Label>Description</Label>
                      <Textarea
                        value={editedPermissions[perm.role]?.description ?? perm.description ?? ''}
                        onChange={(e) => handleDescriptionChange(perm.role, e.target.value)}
                        disabled={isAdmin}
                        placeholder="Role description..."
                      />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {availableHotelRoutes.map((route) => (
                        <div
                          key={route.path}
                          className={`flex items-start space-x-3 p-3 rounded-lg border transition-colors ${
                            currentRoutes.includes(route.path)
                              ? 'bg-primary/5 border-primary/30'
                              : 'bg-muted/30 border-transparent'
                          }`}
                        >
                          <Checkbox
                            id={`${perm.role}-${route.path}`}
                            checked={currentRoutes.includes(route.path)}
                            onCheckedChange={() => handleRouteToggle(perm.role, route.path)}
                            disabled={isAdmin}
                          />
                          <div className="space-y-1">
                            <label
                              htmlFor={`${perm.role}-${route.path}`}
                              className="text-sm font-medium cursor-pointer"
                            >
                              {route.label}
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>

                    {!isAdmin && (
                      <div className="flex justify-end gap-2 pt-4 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReset(perm.role)}
                          disabled={!hasChanges(perm.role)}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Reset
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSave(perm.role)}
                          disabled={!hasChanges(perm.role) || updatePermissions.isPending}
                        >
                          {updatePermissions.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4 mr-2" />
                          )}
                          Save Changes
                        </Button>
                      </div>
                    )}

                    {isAdmin && (
                      <p className="text-sm text-muted-foreground italic">
                        Admin role always has access to all routes and cannot be modified.
                      </p>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      {/* Custom Roles */}
      <div>
        <h4 className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
          <UserCog className="h-4 w-4" />
          Custom Roles
          {customRoles.length > 0 && (
            <Badge variant="outline" className="ml-2">{customRoles.length}</Badge>
          )}
        </h4>
        {customRoles.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <UserCog className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground">No custom roles created yet.</p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={() => setShowCreateDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Custom Role
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Accordion type="multiple" className="space-y-2">
            {customRoles.map((perm) => {
              const currentRoutes = getRoleHotelRoutes(perm.role);
              const Icon = getIconComponent(perm.icon);
              const colorClass = getRoleColorClass(perm.color);

              return (
                <AccordionItem key={perm.role} value={perm.role} className="border rounded-lg px-4">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3">
                      <Icon className={`h-5 w-5 ${colorClass}`} />
                      <span className="font-medium capitalize">{perm.role}</span>
                      <Badge variant={getBadgeVariant(perm.color)}>{perm.role}</Badge>
                      <Badge variant="outline" className="text-xs bg-primary/5">Custom</Badge>
                      {hasChanges(perm.role) && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                          Unsaved
                        </Badge>
                      )}
                      <span className="text-sm text-muted-foreground ml-2">
                        ({currentRoutes.length} routes)
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="py-4 space-y-4">
                      {perm.description && (
                        <p className="text-sm text-muted-foreground mb-4">{perm.description}</p>
                      )}

                      {/* Landing Page Selector */}
                      <div className="space-y-2 mb-4">
                        <Label>Landing Page</Label>
                        <Select
                          value={editedPermissions[perm.role]?.landing_page ?? perm.landing_page ?? ''}
                          onValueChange={(val) => handleLandingPageChange(perm.role, val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a landing page" />
                          </SelectTrigger>
                          <SelectContent>
                            {currentRoutes.map(path => {
                              const routeInfo = availableHotelRoutes.find(r => r.path === path);
                              return (
                                <SelectItem key={path} value={path}>
                                  {routeInfo?.label || path}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Description Field */}
                      <div className="space-y-2 mb-4">
                        <Label>Description</Label>
                        <Textarea
                          value={editedPermissions[perm.role]?.description ?? perm.description ?? ''}
                          onChange={(e) => handleDescriptionChange(perm.role, e.target.value)}
                          placeholder="Role description..."
                        />
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {availableHotelRoutes.map((route) => (
                          <div
                            key={route.path}
                            className={`flex items-start space-x-3 p-3 rounded-lg border transition-colors ${
                              currentRoutes.includes(route.path)
                                ? 'bg-primary/5 border-primary/30'
                                : 'bg-muted/30 border-transparent'
                            }`}
                          >
                            <Checkbox
                              id={`${perm.role}-${route.path}`}
                              checked={currentRoutes.includes(route.path)}
                              onCheckedChange={() => handleRouteToggle(perm.role, route.path)}
                            />
                            <div className="space-y-1">
                              <label
                                htmlFor={`${perm.role}-${route.path}`}
                                className="text-sm font-medium cursor-pointer"
                              >
                                {route.label}
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-between gap-2 pt-4 border-t">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Role
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Custom Role</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete the "{perm.role}" role? This action cannot be undone.
                                Make sure no users are assigned to this role before deleting.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteRole(perm.role)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {deleteRole.isPending ? (
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4 mr-2" />
                                )}
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleReset(perm.role)}
                            disabled={!hasChanges(perm.role)}
                          >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSave(perm.role)}
                            disabled={!hasChanges(perm.role) || updatePermissions.isPending}
                          >
                            {updatePermissions.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4 mr-2" />
                            )}
                            Save Changes
                          </Button>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>

      <Card className="bg-muted/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Permission Changes</CardTitle>
          <CardDescription className="text-xs">
            Changes take effect immediately after saving. Users may need to refresh their browser to see updated permissions.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
