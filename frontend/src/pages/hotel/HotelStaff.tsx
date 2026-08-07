import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useHotelStaff, useCreateStaff, useUpdateStaff, useDeleteStaff } from "@/hooks/useHotel";
import { useCloseAttendanceEntry, useConfirmAttendanceAvailability, useHotelAttendance } from "@/hooks/useHotelAttendance";
import { useStaffShifts } from "@/hooks/useHotelShifts";
import { useRolePermissions, useUpdateRolePermissions, useCreateRole, useDeleteRole, availableHotelRoutes } from "@/hooks/useRolePermissions";
import { Users, Plus, Search, Phone, Mail, Calendar, Clock, Edit, UserCheck, UserX, Lock, KeyRound, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { StaffPinSetup } from "@/components/hotel/StaffPinSetup";
import { HotelStaff as HotelStaffType, HotelStaffAttendance, HotelStaffShift } from "@/types/hotel";
import type { RolePermission } from "@/hooks/useRolePermissions";

const SHIFTS = ["morning", "afternoon", "night"] as const;

interface HotelStaffProps {
  defaultTab?: "active" | "inactive" | "attendance";
  attendanceOnly?: boolean;
}

type AttendanceDepartmentKey =
  | "reception"
  | "waiter"
  | "kitchen"
  | "bar"
  | "housekeeping"
  | "security"
  | "maintenance"
  | "accounts"
  | "management";

interface AttendanceDepartment {
  key: AttendanceDepartmentKey;
  title: string;
  roles: string[];
}

interface AttendanceRosterMember {
  staff: HotelStaffType;
  entry: HotelStaffAttendance | null;
  state: "active" | "inactive" | "pending";
}

const isAttendanceEntryActive = (entry: HotelStaffAttendance) =>
  Boolean(entry.is_active) || (entry.status?.toLowerCase() === "active" && !entry.check_out_time);

const ATTENDANCE_DEPARTMENTS: AttendanceDepartment[] = [
  { key: "reception", title: "Reception", roles: ["receptionist"] },
  { key: "waiter", title: "Waiters", roles: ["waiter"] },
  { key: "kitchen", title: "Kitchen", roles: ["chef"] },
  { key: "bar", title: "Bar", roles: ["barman"] },
  { key: "housekeeping", title: "Housekeeping", roles: ["housekeeping"] },
  { key: "security", title: "Security", roles: ["security"] },
  { key: "maintenance", title: "Maintenance", roles: ["maintenance"] },
  { key: "accounts", title: "Accounts", roles: ["accountant"] },
  { key: "management", title: "Management", roles: ["manager"] },
];

export default function HotelStaff({
  defaultTab = "active",
  attendanceOnly = false,
}: HotelStaffProps) {
  const { data: staff = [], isLoading, isError } = useHotelStaff();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const { data: rolePermissions = [], isLoading: rolesLoading } = useRolePermissions();
  const updateRolePermissions = useUpdateRolePermissions();
  const createRole = useCreateRole();
  const deleteRole = useDeleteRole();
  
  const attendanceDate = format(new Date(), "yyyy-MM-dd");
  const { data: attendance = [], isLoading: attendanceLoading } = useHotelAttendance(attendanceDate);
  const { data: shifts = [] } = useStaffShifts();
  const closeAttendance = useCloseAttendanceEntry();
  const confirmAttendanceAvailability = useConfirmAttendanceAvailability();
  const { formatCurrency } = useSettingsContext();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any>(null);
  const [editingRole, setEditingRole] = useState<RolePermission | null>(null);
  const [pinSetupStaff, setPinSetupStaff] = useState<any>(null);
  const [expandedDepartments, setExpandedDepartments] = useState<
    Partial<Record<AttendanceDepartmentKey, boolean>>
  >({});
  
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    role: "",
    shift: "morning",
    salary: 0,
  });

  const [roleFormData, setRoleFormData] = useState({
    role: "",
    description: "",
    color: "#6366f1",
    icon: "Shield",
    hotel_routes: [] as string[],
    pos_routes: [] as string[],
  });

  const availableRoles = useMemo(() => {
    return rolePermissions.map(rp => rp.role);
  }, [rolePermissions]);

  const getRolePermission = (role: string) => {
    return rolePermissions.find(rp => rp.role === role);
  };

  const filteredStaff = staff.filter(s => {
    const matchesSearch = 
      s.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.email?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "all" || s.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const activeStaffMembers = filteredStaff.filter(s => s.is_active);
  const inactiveStaffMembers = filteredStaff.filter(s => !s.is_active);

  const staffById = useMemo(
    () => new Map(staff.map((member) => [member.id, member])),
    [staff]
  );

  const isOnSelectedAttendanceDate = (value?: string | null) =>
    Boolean(value) && format(new Date(value as string), "yyyy-MM-dd") === attendanceDate;

  const buildFallbackAttendanceFromShift = (shift: HotelStaffShift): HotelStaffAttendance => {
    const shiftStaff = (shift.staff as HotelStaffType | undefined) || staffById.get(shift.staff_id);
    const startTime = shift.started_at || shift.opened_at || shift.created_at;
    const endTime = shift.ended_at || shift.closed_at || null;
    const workedHours = endTime
      ? Number((((new Date(endTime).getTime() - new Date(startTime).getTime()) / 36e5)).toFixed(2))
      : null;

    return {
      id: `shift-${shift.id}`,
      staff_id: shift.staff_id,
      shift_id: shift.id,
      date: isOnSelectedAttendanceDate(startTime) ? attendanceDate : format(new Date(startTime), "yyyy-MM-dd"),
      check_in_time: startTime,
      check_out_time: endTime,
      status: endTime ? "completed" : "active",
      notes: shift.closing_notes || shift.opening_notes || "Generated from shift record",
      worked_hours: workedHours,
      is_active: !endTime,
      source: "shift-fallback",
      created_at: shift.created_at,
      staff: shiftStaff,
    };
  };

  const attendanceRecords = useMemo(() => {
    const records = attendance.map((entry) => ({
      ...entry,
      staff: entry.staff || staffById.get(entry.staff_id),
    }));

    const seenShiftIds = new Set(
      records
        .map((entry) => entry.shift_id)
        .filter((value): value is string => Boolean(value))
    );

    const seenStaffAndStart = new Set(
      records.map((entry) => `${entry.staff_id}-${entry.check_in_time || entry.created_at}`)
    );

    const relevantShifts = shifts.filter((shift) => {
      const startTime = shift.started_at || shift.opened_at || shift.created_at;
      return !shift.closed_at || isOnSelectedAttendanceDate(startTime) || isOnSelectedAttendanceDate(shift.closed_at);
    });

    relevantShifts.forEach((shift) => {
      const startTime = shift.started_at || shift.opened_at || shift.created_at;
      const shiftKey = `${shift.staff_id}-${startTime}`;

      if (seenShiftIds.has(shift.id) || seenStaffAndStart.has(shiftKey)) {
        return;
      }

      records.push(buildFallbackAttendanceFromShift(shift));
    });

    return records.sort((a, b) => {
      const aTime = new Date(a.check_in_time || a.created_at).getTime();
      const bTime = new Date(b.check_in_time || b.created_at).getTime();
      return bTime - aTime;
    });
  }, [attendance, shifts, staffById]);

  const activeAttendance = attendanceRecords.filter(isAttendanceEntryActive);
  const inactiveAttendance = attendanceRecords.filter((entry) => !isAttendanceEntryActive(entry));

  const latestAttendanceByStaff = useMemo(() => {
    const map = new Map<string, HotelStaffAttendance>();

    attendanceRecords.forEach((entry) => {
      if (!map.has(entry.staff_id)) {
        map.set(entry.staff_id, entry);
      }
    });

    return map;
  }, [attendanceRecords]);

  const attendanceRoster = useMemo<AttendanceRosterMember[]>(() => {
    return activeStaffMembers
      .map((member) => {
        const entry = latestAttendanceByStaff.get(member.id) || null;
        const state: AttendanceRosterMember["state"] = !entry
          ? "pending"
          : isAttendanceEntryActive(entry)
            ? "active"
            : "inactive";

        return {
          staff: member,
          entry,
          state,
        };
      })
      .sort((a, b) => {
        const priority = { active: 0, pending: 1, inactive: 2 };
        return priority[a.state] - priority[b.state];
      });
  }, [activeStaffMembers, latestAttendanceByStaff]);

  const waitingAttendanceCount = attendanceRoster.filter((member) => member.state === "pending").length;

  const departmentSections = useMemo(() => {
    return ATTENDANCE_DEPARTMENTS.map((department) => {
      const members = attendanceRoster.filter((member) =>
        department.roles.includes(member.staff.role || "")
      );

      return {
        ...department,
        members,
        activeCount: members.filter((member) => member.state === "active").length,
        inactiveCount: members.filter((member) => member.state !== "active").length,
      };
    }).filter((department) => department.members.length > 0);
  }, [attendanceRoster]);

  const formatDateTime = (value?: string | null) => {
    if (!value) return "-";
    return format(new Date(value), "MMM dd, yyyy hh:mm a");
  };

  const formatWorkedHours = (value?: number | null) => {
    if (value === null || value === undefined) return "-";
    return `${Number(value).toFixed(2)} hrs`;
  };

  const getRoleBadgeColor = (role: string) => {
    const rolePerm = getRolePermission(role);
    return rolePerm?.color || "bg-muted text-muted-foreground";
  };

  const getAttendanceStatusClassName = (state: AttendanceRosterMember["state"]) =>
    state === "active"
      ? "border-green-200 bg-green-500/10 text-green-700 hover:bg-green-500/10"
      : state === "pending"
        ? "border-amber-200 bg-amber-500/10 text-amber-700 hover:bg-amber-500/10"
        : "border-slate-200 bg-slate-500/10 text-slate-700 hover:bg-slate-500/10";

  const getAttendanceStatusLabel = (state: AttendanceRosterMember["state"]) =>
    state === "active" ? "Approved" : state === "pending" ? "Waiting" : "Closed";

  const toggleDepartment = (departmentKey: AttendanceDepartmentKey) => {
    setExpandedDepartments((current) => ({
      ...current,
      [departmentKey]: !current[departmentKey],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingStaff) {
        await updateStaff.mutateAsync({ id: editingStaff.id, ...formData });
        toast.success("Staff member updated");
      } else {
        await createStaff.mutateAsync(formData);
        toast.success("Staff member added");
      }
      setIsAddDialogOpen(false);
      setEditingStaff(null);
      resetForm();
    } catch (error) {
      toast.error("Failed to save staff member");
    }
  };

  const resetForm = () => {
    setFormData({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      role: availableRoles[0] || "",
      shift: "morning",
      salary: 0,
    });
  };

  const openEditDialog = (staffMember: any) => {
    setEditingStaff(staffMember);
    setFormData({
      first_name: staffMember.first_name,
      last_name: staffMember.last_name,
      email: staffMember.email || "",
      phone: staffMember.phone || "",
      role: staffMember.role,
      shift: staffMember.shift || "morning",
      salary: staffMember.salary || 0,
    });
    setIsAddDialogOpen(true);
  };

  const toggleStaffStatus = async (staffMember: any) => {
    try {
      await updateStaff.mutateAsync({ 
        id: staffMember.id, 
        is_active: !staffMember.is_active 
      });
      toast.success(`Staff member ${staffMember.is_active ? 'deactivated' : 'activated'}`);
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const handleRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRole) {
        await updateRolePermissions.mutateAsync({
          role: editingRole.role,
          ...roleFormData,
          is_system: editingRole.is_system,
        });
        toast.success("Role updated successfully");
      } else {
        await createRole.mutateAsync(roleFormData);
        toast.success("Role created successfully");
      }
      setIsRoleDialogOpen(false);
      setEditingRole(null);
      resetRoleForm();
    } catch (error) {
      toast.error("Failed to save role");
    }
  };

  const resetRoleForm = () => {
    setRoleFormData({
      role: "",
      description: "",
      color: "#6366f1",
      icon: "Shield",
      hotel_routes: [],
      pos_routes: [],
    });
  };

  const openEditRoleDialog = (role: RolePermission) => {
    setEditingRole(role);
    setRoleFormData({
      role: role.role,
      description: role.description || "",
      color: role.color || "#6366f1",
      icon: role.icon || "Shield",
      hotel_routes: [...(role.hotel_routes || [])],
      pos_routes: [...(role.pos_routes || [])],
    });
    setIsRoleDialogOpen(true);
  };

  const handleDeleteRole = async (roleName: string) => {
    if (!window.confirm(`Delete role "${roleName}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteRole.mutateAsync(roleName);
      toast.success("Role deleted successfully");
    } catch (error) {
      toast.error("Failed to delete role");
    }
  };

  const toggleRoute = (routeType: 'hotel_routes' | 'pos_routes', routePath: string) => {
    setRoleFormData(prev => {
      const currentRoutes = prev[routeType];
      const newRoutes = currentRoutes.includes(routePath)
        ? currentRoutes.filter(r => r !== routePath)
        : [...currentRoutes, routePath];
      return { ...prev, [routeType]: newRoutes };
    });
  };

  const AttendanceContent = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xl font-bold">{attendanceRecords.length}</p>
                <p className="text-xs text-muted-foreground">Attendance Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <UserCheck className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-xl font-bold">{activeAttendance.length}</p>
                <p className="text-xs text-muted-foreground">Approved Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-500/10 rounded-lg">
                <UserX className="h-5 w-5 text-slate-500" />
              </div>
              <div>
                <p className="text-xl font-bold">{waitingAttendanceCount}</p>
                <p className="text-xs text-muted-foreground">Waiting Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-xl font-bold">
                  {attendanceRecords.reduce((sum, entry) => sum + Number(entry.worked_hours || 0), 0).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">Hours Logged</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {departmentSections.map((department) => (
          <Card key={department.key}>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold">{department.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {department.members.length} staff
                  </p>
                </div>
                <div className="text-right text-xs">
                  <div className="text-green-600 font-medium">{department.activeCount} active</div>
                  <div className="text-muted-foreground">{department.inactiveCount} inactive</div>
                </div>
              </div>

              <div className="space-y-2">
                {department.members.slice(0, 2).map((member) => {
                  const entry = member.entry;

                  return (
                    <div key={`${member.staff.id}-preview`} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">
                          {member.staff.first_name} {member.staff.last_name}
                        </div>
                        <Badge variant="outline" className={getAttendanceStatusClassName(member.state)}>
                          {getAttendanceStatusLabel(member.state)}
                        </Badge>
                      </div>
                      {entry?.check_in_time && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {formatDateTime(entry.check_in_time)}
                        </div>
                      )}
                    </div>
                  );
                })}

                {department.members.length > 2 && !expandedDepartments[department.key] && (
                  <p className="text-xs text-muted-foreground">
                    +{department.members.length - 2} more staff in this department
                  </p>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => toggleDepartment(department.key)}
              >
                {expandedDepartments[department.key] ? "Hide Details" : `Show ${department.title} Details`}
              </Button>

              {expandedDepartments[department.key] && (
                <div className="border-t pt-4">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Start</TableHead>
                          <TableHead>End</TableHead>
                          <TableHead>Worked</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Shift</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {department.members.map((member) => {
                          const entry = member.entry;

                          return (
                            <TableRow key={member.staff.id}>
                              <TableCell>
                                <div className="font-medium">
                                  {member.staff.first_name} {member.staff.last_name}
                                </div>
                                <div className="text-xs text-muted-foreground capitalize">
                                  {member.staff.role || "staff"}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={getAttendanceStatusClassName(member.state)}>
                                  {getAttendanceStatusLabel(member.state)}
                                </Badge>
                              </TableCell>
                              <TableCell>{formatDateTime(entry?.check_in_time)}</TableCell>
                              <TableCell>{formatDateTime(entry?.check_out_time)}</TableCell>
                              <TableCell>{formatWorkedHours(entry?.worked_hours)}</TableCell>
                              <TableCell className="text-xs">
                                {member.staff.phone || member.staff.email || "-"}
                              </TableCell>
                              <TableCell>{entry?.shift_id ? entry.shift_id.slice(0, 8) : "-"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {attendanceLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading attendance...</p>
          ) : attendanceRecords.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No attendance or shift records for today</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start Time</TableHead>
                    <TableHead>Close Time</TableHead>
                    <TableHead>Worked</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendanceRoster.map((member) => {
                    const entry = member.entry;
                    const canCloseEntry = entry && member.state === "active" && !entry.id.startsWith("shift-");

                    return (
                      <TableRow key={member.staff.id}>
                        <TableCell className="font-medium">
                          {member.staff.first_name} {member.staff.last_name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getAttendanceStatusClassName(member.state)}>
                            {getAttendanceStatusLabel(member.state)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDateTime(entry?.check_in_time)}</TableCell>
                        <TableCell>{formatDateTime(entry?.check_out_time)}</TableCell>
                        <TableCell>{formatWorkedHours(entry?.worked_hours)}</TableCell>
                        <TableCell>{entry?.shift_id ? entry.shift_id.slice(0, 8) : "-"}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{entry?.notes || "-"}</TableCell>
                        <TableCell>
                          {canCloseEntry ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => closeAttendance.mutate({ id: entry.id })}
                              disabled={closeAttendance.isPending}
                            >
                              Close Work
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() =>
                                confirmAttendanceAvailability.mutate({
                                  staffId: member.staff.id,
                                  staffRole: member.staff.role,
                                  shiftLabel: `${member.staff.first_name}'s ${member.staff.shift || member.staff.role} Shift`,
                                  notes: "Confirmed available from attendance management",
                                })
                              }
                              disabled={confirmAttendanceAvailability.isPending}
                            >
                              Confirm Available
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const StaffTable = ({ staffList }: { staffList: HotelStaffType[] }) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Shift</TableHead>
            <TableHead>PIN</TableHead>
            <TableHead>Hire Date</TableHead>
            <TableHead>Salary</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staffList.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">
                {s.first_name} {s.last_name}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  {s.email && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      {s.email}
                    </div>
                  )}
                  {s.phone && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {s.phone}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge className={getRoleBadgeColor(s.role)}>
                  {s.role}
                </Badge>
              </TableCell>
              <TableCell className="capitalize">{s.shift}</TableCell>
              <TableCell>
                {s.pin ? (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    <KeyRound className="h-3 w-3 mr-1" />
                    Set
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Not set
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                {s.hire_date ? format(new Date(s.hire_date), "MMM dd, yyyy") : "-"}
              </TableCell>
              <TableCell>{formatCurrency(s.salary || 0)}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => openEditDialog(s)} title="Edit">
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPinSetupStaff(s)} title="PIN & Access">
                    <Lock className="h-3 w-3" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm(`Delete ${s.first_name} ${s.last_name}? This action cannot be undone.`)) {
                        deleteStaff.mutateAsync(s.id);
                      }
                    }}
                    title="Delete"
                    disabled={deleteStaff.isPending}
                  >
                    <UserX className="h-3 w-3" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant={s.is_active ? "destructive" : "default"}
                    onClick={() => toggleStaffStatus(s)}
                    title={s.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {s.is_active ? <UserX className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const RoleManagementContent = () => (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isRoleDialogOpen} onOpenChange={(open) => {
          setIsRoleDialogOpen(open);
          if (!open) {
            setEditingRole(null);
            resetRoleForm();
          }
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Role
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingRole ? "Edit Role" : "Create New Role"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRoleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Role Name</Label>
                  <Input
                    value={roleFormData.role}
                    onChange={(e) => setRoleFormData({ ...roleFormData, role: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                    required
                    disabled={!!editingRole}
                    placeholder="e.g., supervisor"
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input
                    value={roleFormData.description}
                    onChange={(e) => setRoleFormData({ ...roleFormData, description: e.target.value })}
                    placeholder="Role description"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Color</Label>
                  <Input
                    type="color"
                    value={roleFormData.color}
                    onChange={(e) => setRoleFormData({ ...roleFormData, color: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Icon</Label>
                  <Input
                    value={roleFormData.icon}
                    onChange={(e) => setRoleFormData({ ...roleFormData, icon: e.target.value })}
                    placeholder="Icon name"
                  />
                </div>
              </div>
              
              <Separator />
              
              <div>
                <Label className="text-base font-semibold">Hotel Page Access</Label>
                <ScrollArea className="h-64 w-full rounded-md border p-4 mt-2">
                  <div className="space-y-3">
                    {availableHotelRoutes.map((route) => (
                      <div key={route.path} className="flex items-center space-x-2">
                        <Checkbox
                          id={`hotel-${route.path}`}
                          checked={roleFormData.hotel_routes.includes(route.path)}
                          onCheckedChange={() => toggleRoute('hotel_routes', route.path)}
                        />
                        <Label htmlFor={`hotel-${route.path}`} className="text-sm">
                          {route.label}
                          <span className="text-xs text-muted-foreground ml-2">({route.path})</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <Button type="submit" className="w-full">
                {editingRole ? "Update Role" : "Create Role"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          {rolesLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading roles...</p>
          ) : rolePermissions.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No roles found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Pages Access</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rolePermissions.map((rp) => (
                  <TableRow key={rp.role}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4" style={{ color: rp.color || '#6366f1' }} />
                        <span className="font-medium capitalize">{rp.role}</span>
                      </div>
                    </TableCell>
                    <TableCell>{rp.description || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {rp.hotel_routes.slice(0, 3).map((route) => (
                          <Badge key={route} variant="secondary" className="text-xs">
                            {route.split('/').pop()}
                          </Badge>
                        ))}
                        {rp.hotel_routes.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{rp.hotel_routes.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rp.is_system ? "default" : "secondary"}>
                        {rp.is_system ? "System" : "Custom"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditRoleDialog(rp)}
                          disabled={rp.is_system}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDeleteRole(rp.role)}
                          disabled={rp.is_system}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">
              {attendanceOnly ? "Attendance Management" : "Staff Management"}
            </h1>
            <p className="text-muted-foreground">
              {attendanceOnly
                ? "See who has started work and who is inactive today"
                : "Manage hotel staff, roles, and page access"}
            </p>
          </div>
          {!attendanceOnly && (
            <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
              setIsAddDialogOpen(open);
              if (!open) {
                setEditingStaff(null);
                resetForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Staff
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingStaff ? "Edit Staff Member" : "Add New Staff Member"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>First Name</Label>
                      <Input
                        value={formData.first_name}
                        onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label>Last Name</Label>
                      <Input
                        value={formData.last_name}
                        onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Phone</Label>
                      <Input
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Role</Label>
                      <Select
                        value={formData.role}
                        onValueChange={(value) => setFormData({ ...formData, role: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableRoles.map((role) => (
                            <SelectItem key={role} value={role} className="capitalize">
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Shift</Label>
                      <Select
                        value={formData.shift}
                        onValueChange={(value) => setFormData({ ...formData, shift: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SHIFTS.map((shift) => (
                            <SelectItem key={shift} value={shift} className="capitalize">
                              {shift}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Monthly Salary</Label>
                    <Input
                      type="number"
                      value={formData.salary}
                      onChange={(e) => setFormData({ ...formData, salary: Number(e.target.value) })}
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    {editingStaff ? "Update Staff" : "Add Staff"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {attendanceOnly ? (
          <AttendanceContent />
        ) : (
          <>
            <Tabs defaultValue="staff">
              <TabsList>
                <TabsTrigger value="staff">Staff</TabsTrigger>
                <TabsTrigger value="roles">Roles & Access</TabsTrigger>
                <TabsTrigger value="attendance">Attendance</TabsTrigger>
              </TabsList>
              <TabsContent value="staff">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <Users className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-xl font-bold">{staff.length}</p>
                          <p className="text-xs text-muted-foreground">Total</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-500/10 rounded-lg">
                          <UserCheck className="h-5 w-5 text-green-500" />
                        </div>
                        <div>
                          <p className="text-xl font-bold">{staff.filter(s => s.is_active).length}</p>
                          <p className="text-xs text-muted-foreground">Active</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg">
                          <Clock className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-xl font-bold">{staff.filter(s => s.shift === 'morning').length}</p>
                          <p className="text-xs text-muted-foreground">Morning</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/10 rounded-lg">
                          <KeyRound className="h-5 w-5 text-amber-500" />
                        </div>
                        <div>
                          <p className="text-xl font-bold">{staff.filter(s => s.pin).length}</p>
                          <p className="text-xs text-muted-foreground">With PIN</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/10 rounded-lg">
                          <Calendar className="h-5 w-5 text-purple-500" />
                        </div>
                        <div>
                          <p className="text-xl font-bold">{staff.filter(s => s.role === 'manager').length}</p>
                          <p className="text-xs text-muted-foreground">Managers</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search staff..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-full sm:w-48">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      {availableRoles.map((role) => (
                        <SelectItem key={role} value={role} className="capitalize">
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Tabs defaultValue={defaultTab}>
                  <TabsList>
                    <TabsTrigger value="active">Active ({activeStaffMembers.length})</TabsTrigger>
                    <TabsTrigger value="inactive">Inactive ({inactiveStaffMembers.length})</TabsTrigger>
                    <TabsTrigger value="attendance">Attendance ({attendanceRoster.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="active">
                    <Card>
                      <CardContent className="pt-6">
                        {isLoading ? (
                          <p className="text-center py-8 text-muted-foreground">Loading...</p>
                        ) : isError && activeStaffMembers.length === 0 ? (
                          <p className="text-center py-8 text-muted-foreground">Unable to load staff right now. Please try again.</p>
                        ) : activeStaffMembers.length === 0 ? (
                          <p className="text-center py-8 text-muted-foreground">No active staff found</p>
                        ) : (
                          <StaffTable staffList={activeStaffMembers} />
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="inactive">
                    <Card>
                      <CardContent className="pt-6">
                        {isError && inactiveStaffMembers.length === 0 ? (
                          <p className="text-center py-8 text-muted-foreground">Unable to load staff right now. Please try again.</p>
                        ) : inactiveStaffMembers.length === 0 ? (
                          <p className="text-center py-8 text-muted-foreground">No inactive staff</p>
                        ) : (
                          <StaffTable staffList={inactiveStaffMembers} />
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="attendance">
                    <AttendanceContent />
                  </TabsContent>
                </Tabs>
              </TabsContent>
              
              <TabsContent value="roles">
                <RoleManagementContent />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {pinSetupStaff && (
        <StaffPinSetup
          open={!!pinSetupStaff}
          onOpenChange={(open) => !open && setPinSetupStaff(null)}
          staffId={pinSetupStaff.id}
          staffName={`${pinSetupStaff.first_name} ${pinSetupStaff.last_name}`}
          role={pinSetupStaff.role}
          currentPin={pinSetupStaff.pin}
          currentRoutes={pinSetupStaff.allowed_hotel_routes || []}
        />
      )}
    </Layout>
  );
}