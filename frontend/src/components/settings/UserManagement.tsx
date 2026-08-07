import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { useUserRoles, useUpdateUserRole, useRemoveUserRole, UserRoleWithProfile } from "@/hooks/useSettings";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { Plus, Loader2, Search, Mail, Shield, Users, UserPlus, UserX, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { apiClient } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { getIconComponent, getRoleColorClass, getBadgeVariant } from "@/lib/roleHelpers";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const userRoleSchema = z.object({
  user_email: z.string().email("Valid email is required"),
  role: z.string().min(1, "Role is required"),
  reason: z.string().optional(),
});

type GroupedUserRole = {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
  roles: string[];
};

export function UserManagement() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [searchingUser, setSearchingUser] = useState(false);
  const [foundUser, setFoundUser] = useState<{ user_id: string; email: string; created_at: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ user: any; role: string; reason?: string } | null>(null);
  const [editingUser, setEditingUser] = useState<GroupedUserRole | null>(null);
  const [editRole, setEditRole] = useState("");
  const [removeAction, setRemoveAction] = useState<{ user: GroupedUserRole; role: string } | null>(null);
  const { user } = useAuth();
  const { data: userRoles, isLoading } = useUserRoles();
  const { data: rolePermissions, isLoading: rolesLoading } = useRolePermissions();
  const updateUserRole = useUpdateUserRole();
  const removeUserRole = useRemoveUserRole();
  const { toast } = useToast();

  const groupedUserRoles = useMemo<GroupedUserRole[]>(() => {
    const grouped = new Map<string, GroupedUserRole>();

    (userRoles || []).forEach((entry) => {
      const existing = grouped.get(entry.user_id);
      const nextRoles = Array.from(new Set([...(existing?.roles || []), entry.role])).sort((left, right) =>
        left.localeCompare(right)
      );

      grouped.set(entry.user_id, {
        user_id: entry.user_id,
        email: entry.email ?? existing?.email ?? null,
        first_name: entry.first_name ?? existing?.first_name ?? null,
        last_name: entry.last_name ?? existing?.last_name ?? null,
        created_at: existing?.created_at
          ? (new Date(existing.created_at) <= new Date(entry.created_at) ? existing.created_at : entry.created_at)
          : entry.created_at,
        updated_at: existing?.updated_at
          ? (new Date(existing.updated_at) >= new Date(entry.updated_at) ? existing.updated_at : entry.updated_at)
          : entry.updated_at,
        roles: nextRoles,
      });
    });

    return Array.from(grouped.values()).sort((left, right) => {
      const leftName = `${left.first_name || ''} ${left.last_name || ''}`.trim() || left.email || left.user_id;
      const rightName = `${right.first_name || ''} ${right.last_name || ''}`.trim() || right.email || right.user_id;
      return leftName.localeCompare(rightName);
    });
  }, [userRoles]);

  const form = useForm<z.infer<typeof userRoleSchema>>({
    resolver: zodResolver(userRoleSchema),
    defaultValues: {
      user_email: "",
      role: "user",
      reason: "",
    },
  });

  const searchUserByEmail = async (email: string) => {
    if (!email.trim()) return;
    
    setSearchingUser(true);
    try {
      const { data, error } = await apiClient.rpc('get_user_by_email', { user_email: email.trim() });
      
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        setFoundUser(null);
        return;
      }
      
      if (data && data.length > 0) {
        setFoundUser(data[0]);
        toast({ title: "User Found", description: `Found user: ${data[0].email}` });
      } else {
        setFoundUser(null);
        toast({ title: "User Not Found", description: "No user found with this email address", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to search for user", variant: "destructive" });
      setFoundUser(null);
    } finally {
      setSearchingUser(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof userRoleSchema>) => {
    if (!foundUser) {
      toast({ title: "Error", description: "Please search and select a user first", variant: "destructive" });
      return;
    }
    setConfirmAction({ user: foundUser, role: values.role, reason: values.reason });
  };

  const confirmRoleAssignment = async () => {
    if (!confirmAction) return;

    try {
      await updateUserRole.mutateAsync({
        user_id: confirmAction.user.user_id,
        role: confirmAction.role,
        reason: confirmAction.reason || "Role added via admin interface",
      });
      
      toast({ title: "Success", description: `Role saved successfully for ${confirmAction.user.email}` });
      setIsAddDialogOpen(false);
      setFoundUser(null);
      setConfirmAction(null);
      form.reset();
    } catch {
      toast({ title: "Error", description: "Failed to assign role", variant: "destructive" });
    }
  };

  const handleInlineRoleChange = async () => {
    if (!editingUser || !editRole) return;

    try {
      await updateUserRole.mutateAsync({
        user_id: editingUser.user_id,
        role: editRole,
        reason: "Role added via inline edit",
      });
      toast({ title: "Success", description: `Role saved for ${editingUser.email || editingUser.user_id}` });
      setEditingUser(null);
      setEditRole("");
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to save role", variant: "destructive" });
    }
  };

  const handleRemoveRole = async () => {
    if (!removeAction) return;

    try {
      await removeUserRole.mutateAsync({
        user_id: removeAction.user.user_id,
        role: removeAction.role,
        reason: "Role removed via admin interface",
      });
      toast({ title: "Success", description: `Removed ${removeAction.role} from ${removeAction.user.email || removeAction.user.user_id}` });
      setRemoveAction(null);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to remove role", variant: "destructive" });
    }
  };

  const getUserDisplayName = (userRole: GroupedUserRole) => {
    if (userRole.first_name || userRole.last_name) {
      return `${userRole.first_name || ''} ${userRole.last_name || ''}`.trim();
    }
    return userRole.email || userRole.user_id.substring(0, 8) + '...';
  };

  const isSelf = (userId: string) => user?.id === userId;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">User Roles & Permissions</h3>
          <p className="text-sm text-muted-foreground">
            Manage user access levels and permissions ({userRoles?.length || 0} users)
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add User Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add User Role</DialogTitle>
              <DialogDescription>
                Search for a user by email and assign them a role.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="user_email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>User Email</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input 
                            placeholder="Enter user email address" 
                            {...field}
                            onChange={(e) => { field.onChange(e); setFoundUser(null); }}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => searchUserByEmail(field.value)}
                          disabled={searchingUser || !field.value}
                        >
                          {searchingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </Button>
                      </div>
                      <FormMessage />
                      {foundUser && (
                        <div className="mt-2 p-2 bg-primary/5 border border-primary/20 rounded">
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-4 w-4 text-primary" />
                            <span>Found: {foundUser.email}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Created: {new Date(foundUser.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      )}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {rolesLoading ? (
                            <div className="p-2 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
                          ) : (
                            rolePermissions?.map((role) => {
                              const Icon = getIconComponent(role.icon);
                              const colorClass = getRoleColorClass(role.color);
                              return (
                                <SelectItem key={role.role} value={role.role}>
                                  <div className="flex items-center gap-2">
                                    <Icon className={`h-4 w-4 ${colorClass}`} />
                                    <span className="capitalize">{role.role}</span>
                                    {!role.is_system && <Badge variant="outline" className="text-xs ml-1">Custom</Badge>}
                                  </div>
                                </SelectItem>
                              );
                            })
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Reason for role assignment..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={updateUserRole.isPending || !foundUser}>
                    {updateUserRole.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Assign Role
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        
        {/* Confirmation Dialog */}
        <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Role Assignment</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  {confirmAction && (
                    <>
                      <p>You are about to add the role <strong className="capitalize">{confirmAction.role}</strong> to:</p>
                      <div className="bg-muted p-3 rounded border">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-primary" />
                          <span className="font-medium">{confirmAction.user.email}</span>
                        </div>
                      </div>
                      {confirmAction.reason && (
                        <div>
                          <p className="text-sm font-medium">Reason:</p>
                          <p className="text-sm text-muted-foreground">{confirmAction.reason}</p>
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground mt-2">
                        ⚠️ This action will be logged in the audit trail.
                      </p>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmRoleAssignment}>
                Confirm Assignment
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Inline Edit Confirmation */}
        <AlertDialog open={!!editingUser} onOpenChange={() => { setEditingUser(null); setEditRole(""); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add User Role</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>Add another role for <strong>{editingUser?.email || editingUser?.user_id}</strong></p>
                  <div className="bg-muted p-3 rounded border space-y-1">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Current roles: </span>
                      <span className="inline-flex flex-wrap gap-1 align-middle">
                        {editingUser?.roles.map((role) => (
                          <Badge key={role} variant="outline" className="capitalize">{role}</Badge>
                        ))}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Name: </span>
                      <span>{editingUser ? getUserDisplayName(editingUser) : ''}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>New Role</Label>
                    <Select value={editRole} onValueChange={setEditRole}>
                      <SelectTrigger><SelectValue placeholder="Select new role" /></SelectTrigger>
                      <SelectContent>
                        {rolePermissions?.map((role) => {
                          const Icon = getIconComponent(role.icon);
                          const colorClass = getRoleColorClass(role.color);
                          return (
                            <SelectItem key={role.role} value={role.role}>
                              <div className="flex items-center gap-2">
                                <Icon className={`h-4 w-4 ${colorClass}`} />
                                <span className="capitalize">{role.role}</span>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground">⚠️ This change will be logged in the audit trail.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleInlineRoleChange}
                disabled={!editRole || editingUser?.roles.includes(editRole) || updateUserRole.isPending}
              >
                {updateUserRole.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Role
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!removeAction} onOpenChange={() => setRemoveAction(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove User Role</AlertDialogTitle>
              <AlertDialogDescription>
                Remove the <strong className="capitalize">{removeAction?.role}</strong> role from{" "}
                <strong>{removeAction?.user.email || removeAction?.user.user_id}</strong>?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRemoveRole}
                disabled={removeUserRole.isPending}
              >
                {removeUserRole.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Remove Role
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* User List */}
      <div className="grid gap-3">
        {groupedUserRoles.length > 0 ? (
          groupedUserRoles.map((userRole) => {
            const primaryRole = userRole.roles[0] || "user";
            const roleData = rolePermissions?.find(r => r.role === primaryRole);
            const Icon = getIconComponent(roleData?.icon || null);
            const colorClass = getRoleColorClass(roleData?.color || null);
            const displayName = getUserDisplayName(userRole);
            const self = isSelf(userRole.user_id);

            return (
              <Card key={userRole.user_id} className={self ? 'border-primary/30' : ''}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full bg-muted`}>
                        <Icon className={`h-5 w-5 ${colorClass}`} />
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {displayName}
                          {self && <Badge variant="outline" className="text-xs">You</Badge>}
                        </div>
                        {userRole.email && (
                          <div className="text-sm text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {userRole.email}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Joined {new Date(userRole.created_at).toLocaleDateString()} · Updated {new Date(userRole.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {userRole.roles.map((role) => {
                        const assignedRole = rolePermissions?.find((entry) => entry.role === role);
                        return (
                          <div key={role} className="flex items-center gap-1 rounded-md border px-2 py-1">
                            <Badge variant={getBadgeVariant(assignedRole?.color || null)} className="capitalize">
                              {role}
                            </Badge>
                            {!self && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={() => setRemoveAction({ user: userRole, role })}
                                title={`Remove ${role}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                      {!self && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setEditingUser(userRole); setEditRole(""); }}
                          title="Add role"
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card>
            <CardContent className="py-8">
              <div className="text-center">
                <UserX className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium">No user roles configured</h3>
                <p className="text-sm text-muted-foreground">Add user roles to manage access permissions</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dynamic Role Descriptions from DB */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Available Roles
          </CardTitle>
          <CardDescription>
            Roles configured in the system and their route access
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {rolePermissions?.map((role) => {
              const Icon = getIconComponent(role.icon);
              const colorClass = getRoleColorClass(role.color);
              const totalRoutes = (role.pos_routes?.length || 0) + (role.hotel_routes?.length || 0);
              const assignedCount = groupedUserRoles.filter((user) => user.roles.includes(role.role)).length;

              return (
                <div key={role.role} className="flex justify-between items-center p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Icon className={`h-7 w-7 ${colorClass}`} />
                    <div>
                      <div className="font-medium capitalize flex items-center gap-2">
                        {role.role}
                        {role.is_system && <Badge variant="secondary" className="text-xs">System</Badge>}
                        {!role.is_system && <Badge variant="outline" className="text-xs">Custom</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {role.description || (role.role === 'admin' ? 'Full system access' : `${totalRoutes} routes assigned`)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      <Users className="h-3 w-3 mr-1" />
                      {assignedCount} {assignedCount === 1 ? 'user' : 'users'}
                    </Badge>
                    <Badge variant={getBadgeVariant(role.color)} className="capitalize">
                      {role.role}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
