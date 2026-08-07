import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { apiClient } from "@/integrations/supabase/client";
import { getLocalData } from "@/lib/localDataService";
import { syncService } from "@/lib/syncService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateHotelTable,
  useDeleteHotelTable,
  useHotelTables,
  useUpdateHotelTable,
  useUpdateHotelTableStatus,
} from "@/hooks/useHotelTables";
import { resetBackendReachable } from "@/integrations/supabase/client";
import type { HotelOrder, HotelTable, HotelTableStatus } from "@/types/hotel";
import {
  ClipboardList,
  Edit,
  MapPin,
  Plus,
  Trash2,
  Users,
  User,
} from "lucide-react";
import { TableStatusScene } from "@/components/hotel/TableStatusScene";
import { getEffectiveHotelTableStatus, isUncheckedInReservationOrder } from "@/lib/hotelAccess";

const TABLE_STATUSES: HotelTableStatus[] = ["free", "reserved", "occupied", "cleaning"];
const ACTIVE_TABLE_ORDER_STATUSES = [
  "pending",
  "preparing",
  "ready",
  "served",
  "awaiting_approval",
  "pending_handover",
  "confirmed",
  "billed",
  "paid",
] as const;

const statusStyles: Record<HotelTableStatus, string> = {
  free: "bg-emerald-100 text-emerald-700 border-emerald-200",
  reserved: "bg-amber-100 text-amber-700 border-amber-200",
  occupied: "bg-rose-100 text-rose-700 border-rose-200",
  cleaning: "bg-slate-100 text-slate-700 border-slate-200",
};

const cardStyles: Record<HotelTableStatus, string> = {
  free: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50",
  reserved: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50",
  occupied: "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50",
  cleaning: "border-slate-200 bg-gradient-to-br from-slate-100 via-white to-slate-50",
};

type FormState = {
  table_number: string;
  name: string;
  area: string;
  capacity: number;
  status: HotelTableStatus;
  notes: string;
  is_active: boolean;
};

type ActiveTableOrder = {
  id: string;
  table_id: string | null;
  table_number: string | null;
  order_number: string;
  status: string;
  order_type?: HotelOrder["order_type"] | null;
  checked_in_at?: string | null;
  waiter_id?: string | null;
  staff_id?: string | null;
  assigned_waiter_id?: string | null;
  created_at: string | null;
  total_amount: number;
  waiter: {
    id: string;
    first_name: string;
    last_name: string;
    role: string;
  } | null;
  assigned_waiter?: {
    id: string;
    first_name: string;
    last_name: string;
    role: string;
  } | null;
};

const defaultForm: FormState = {
  table_number: "",
  name: "",
  area: "",
  capacity: 4,
  status: "free",
  notes: "",
  is_active: true,
};

function normalizeTableNumber(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function formatTableNumber(tableNumber: string) {
  const normalized = normalizeTableNumber(tableNumber);
  const numericPart = normalized.replace(/^TABLE[-\s]*/i, "").replace(/^T[-\s]*/i, "");

  if (/^\d+$/.test(numericPart)) {
    return `Table ${Number(numericPart)}`;
  }

  if (normalized.startsWith("TABLE")) {
    return normalized;
  }

  return `Table ${normalized}`;
}

function getWaiterName(order?: ActiveTableOrder | null) {
  const waiter = order?.waiter || order?.assigned_waiter;
  if (!waiter) return null;
  return `${waiter.first_name} ${waiter.last_name}`.trim();
}

function getTableServiceLabel(status: HotelTableStatus, waiterName?: string | null) {
  if (status === "reserved") {
    return waiterName ? `Reserved by ${waiterName}` : "Reserved and waiting for arrival";
  }

  if (status === "occupied") {
    return waiterName ? `Served by ${waiterName}` : "Guests are seated";
  }

  if (status === "cleaning") {
    return "Resetting table for the next service";
  }

  return "Ready for new guests";
}

function toActiveTableOrder(
  order: Partial<HotelOrder> & {
    waiter?: ActiveTableOrder["waiter"] | null;
    assigned_waiter?: ActiveTableOrder["assigned_waiter"] | null;
  }
) {
  return {
    id: order.id || "",
    table_id: order.table_id || null,
    table_number: order.table_number || null,
    order_number: order.order_number || "",
    status: order.status || "pending",
    order_type: order.order_type || null,
    checked_in_at: order.checked_in_at || null,
    waiter_id: order.waiter_id || null,
    staff_id: order.staff_id || null,
    assigned_waiter_id: order.assigned_waiter_id || null,
    created_at: order.created_at || null,
    total_amount: Number(order.total_amount || 0),
    waiter: order.waiter || order.assigned_waiter || null,
    assigned_waiter: order.assigned_waiter || null,
  } as ActiveTableOrder;
}

function mergeActiveOrders(localOrders: ActiveTableOrder[], remoteOrders: ActiveTableOrder[]) {
  const merged = new Map<string, ActiveTableOrder>();

  for (const order of localOrders) {
    merged.set(order.id, order);
  }

  for (const order of remoteOrders) {
    const existing = merged.get(order.id);
    if (!existing) {
      merged.set(order.id, order);
      continue;
    }

    const existingUpdated = new Date(existing.created_at || 0).getTime();
    const remoteUpdated = new Date(order.created_at || 0).getTime();
    merged.set(order.id, remoteUpdated >= existingUpdated ? order : existing);
  }

  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

export default function HotelTables() {
  const { data: tables = [], isLoading } = useHotelTables(true);
  const createTable = useCreateHotelTable();
  const updateTable = useUpdateHotelTable();
  const updateTableStatus = useUpdateHotelTableStatus();
  const deleteTable = useDeleteHotelTable();
  const { data: activeTableOrders = [] } = useQuery({
    queryKey: ["hotel-table-active-orders"],
    queryFn: async () => {
      const cachedOrders = await getLocalData<HotelOrder>("hotel_orders");
      const localActiveOrders = (cachedOrders || [])
        .filter((order) =>
          isUncheckedInReservationOrder(order) ||
          ACTIVE_TABLE_ORDER_STATUSES.includes(order.status as typeof ACTIVE_TABLE_ORDER_STATUSES[number])
        )
        .map((order) => toActiveTableOrder(order));

      if (!navigator.onLine) {
        return localActiveOrders;
      }

      try {
        const { data, error } = await apiClient
          .from("hotel_orders")
          .select(
            `
              id,
              table_id,
              table_number,
              order_number,
              status,
              order_type,
              checked_in_at,
              waiter_id,
              staff_id,
              assigned_waiter_id,
              created_at,
              total_amount,
              waiter:hotel_staff!hotel_orders_waiter_id_fkey(id, first_name, last_name, role),
              assigned_waiter:hotel_staff!hotel_orders_assigned_waiter_id_fkey(id, first_name, last_name, role)
            `
          )
          .order("created_at", { ascending: false });

        if (error) throw error;

        return mergeActiveOrders(
          localActiveOrders,
          ((data || []) as HotelOrder[])
            .filter((order) =>
              isUncheckedInReservationOrder(order) ||
              ACTIVE_TABLE_ORDER_STATUSES.includes(order.status as typeof ACTIVE_TABLE_ORDER_STATUSES[number])
            )
            .map((order) => toActiveTableOrder(order))
        );
      } catch (error) {
        syncService.syncFromCloud("hotel_orders").catch(() => {});
        return localActiveOrders;
      }
    },
    staleTime: 5000,
  });

  const [open, setOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<HotelTable | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [search, setSearch] = useState("");

  const ordersByTable = useMemo(() => {
    const map = new Map<string, ActiveTableOrder>();

    activeTableOrders.forEach((order) => {
      if (order.table_id && !map.has(`id:${order.table_id}`)) {
        map.set(`id:${order.table_id}`, order);
      }

      const normalizedNumber = normalizeTableNumber(order.table_number);
      if (normalizedNumber && !map.has(`num:${normalizedNumber}`)) {
        map.set(`num:${normalizedNumber}`, order);
      }
    });

    return map;
  }, [activeTableOrders]);

  const enrichedTables = useMemo(() => {
    return tables.map((table) => {
      const currentOrder =
        ordersByTable.get(`id:${table.id}`) ||
        ordersByTable.get(`num:${normalizeTableNumber(table.table_number)}`) ||
        null;
      const activeOrder = currentOrder;
      const effectiveStatus = getEffectiveHotelTableStatus(table.status, currentOrder);

      return {
        ...table,
        currentOrder,
        activeOrder,
        effectiveStatus,
      };
    });
  }, [ordersByTable, tables]);

  const filteredTables = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return enrichedTables;
    return enrichedTables.filter((table) =>
      [
        table.table_number,
        table.name,
        table.area,
        formatTableNumber(table.table_number),
        table.currentOrder?.order_number,
        getWaiterName(table.currentOrder),
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term))
    );
  }, [enrichedTables, search]);

  const editingTableWithOccupancy = useMemo(() => {
    if (!editingTable) return null;

    return (
      enrichedTables.find((table) => table.id === editingTable.id) ||
      null
    );
  }, [editingTable, enrichedTables]);

  const isEditingOccupiedTable = !!editingTableWithOccupancy?.activeOrder;

  const summary = useMemo(() => {
    return TABLE_STATUSES.reduce(
      (acc, status) => {
        acc[status] = enrichedTables.filter((table) => table.effectiveStatus === status && table.is_active).length;
        return acc;
      },
      { free: 0, reserved: 0, occupied: 0, cleaning: 0 } as Record<HotelTableStatus, number>
    );
  }, [enrichedTables]);

  const resetForm = () => {
    setEditingTable(null);
    setForm(defaultForm);
  };

  const openEdit = (table: HotelTable) => {
    setEditingTable(table);
    setForm({
      table_number: table.table_number,
      name: table.name || "",
      area: table.area || "",
      capacity: table.capacity,
      status: table.status,
      notes: table.notes || "",
      is_active: table.is_active,
    });
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      table_number: form.table_number,
      name: form.name || null,
      area: form.area || null,
      capacity: Number(form.capacity || 0) || 1,
      status: form.status,
      notes: form.notes || null,
      is_active: form.is_active,
    };

    if (editingTable) {
      await updateTable.mutateAsync({ id: editingTable.id, ...payload });
    } else {
      await createTable.mutateAsync(payload);
    }

    setOpen(false);
    resetForm();
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">TABLE MANAGEMENT</h1>
            <p className="text-muted-foreground">
              Manage dining and service tables with live status, waiter assignment insight, and a richer floor-card view.
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                resetBackendReachable();
                window.location.reload();
              }}
            >
              Refresh
            </Button>
            <Dialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                if (!next) resetForm();
              }}
            >
              <DialogTrigger asChild>
                <Button onClick={() => resetForm()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Table
                </Button>
              </DialogTrigger>
              <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingTable ? "Edit Table" : "Create Table"}</DialogTitle>
                <DialogDescription>
                  Configure the table identity, status, capacity, and service area.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="table-number">Table Number</Label>
                    <Input
                      id="table-number"
                      value={form.table_number}
                      onChange={(e) => setForm((prev) => ({ ...prev, table_number: e.target.value.toUpperCase() }))}
                      placeholder="T-01"
                      disabled={isEditingOccupiedTable}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="table-name">Display Name</Label>
                    <Input
                      id="table-name"
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Garden Table"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="table-area">Area</Label>
                    <Input
                      id="table-area"
                      value={form.area}
                      onChange={(e) => setForm((prev) => ({ ...prev, area: e.target.value }))}
                      placeholder="Restaurant / Bar / Terrace"
                    />
                  </div>
                  <div>
                    <Label htmlFor="table-capacity">Capacity</Label>
                    <Input
                      id="table-capacity"
                      type="number"
                      min={1}
                      value={form.capacity}
                      onChange={(e) => setForm((prev) => ({ ...prev, capacity: Number(e.target.value) }))}
                    />
                  </div>
                </div>
                {isEditingOccupiedTable && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    This table has an active order. Table number, status, active state, and removal are locked until service is completed.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Status</Label>
                    <Select
                      value={form.status}
                      disabled={isEditingOccupiedTable}
                      onValueChange={(value: HotelTableStatus) => setForm((prev) => ({ ...prev, status: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TABLE_STATUSES.map((status) => (
                          <SelectItem key={status} value={status} className="capitalize">
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end justify-between rounded-md border px-3 py-2">
                    <div>
                      <Label className="text-sm">Active Table</Label>
                      <p className="text-xs text-muted-foreground">Inactive tables stay hidden from live service selection.</p>
                    </div>
                    <Switch
                      checked={form.is_active}
                      disabled={isEditingOccupiedTable}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, is_active: checked }))}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="table-notes">Notes</Label>
                  <Textarea
                    id="table-notes"
                    value={form.notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Special setup, service instructions, or table remarks"
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createTable.isPending || updateTable.isPending}>
                    {editingTable ? "Save Changes" : "Create Table"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <ClipboardList className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{tables.filter((table) => table.is_active).length}</p>
                  <p className="text-xs text-muted-foreground">Active Tables</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {TABLE_STATUSES.map((status) => (
            <Card key={status}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={`rounded-lg border px-2 py-2 ${statusStyles[status]}`}>
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{summary[status]}</p>
                    <p className="text-xs capitalize text-muted-foreground">{status}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Live Table Floor</CardTitle>
              <p className="text-sm text-muted-foreground">
                Advanced service cards showing table setup, waiter coverage, and the latest active order.
              </p>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by table, area, waiter, or order number"
              className="md:w-80"
            />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-8 text-center text-muted-foreground">Loading hotel tables...</p>
            ) : filteredTables.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">No tables found.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredTables.map((table) => {
                  const waiterName = getWaiterName(table.activeOrder);
                  const naturalTableNumber = formatTableNumber(table.table_number);
                  const serviceLabel = getTableServiceLabel(table.effectiveStatus, waiterName);

                  return (
                    <Card
                      key={table.id}
                      className={`overflow-hidden border shadow-[0_18px_60px_rgba(15,23,42,0.08)] ${cardStyles[table.effectiveStatus]}`}
                    >
                      <CardContent className="p-0">
                        <div className="relative p-5">
                          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/70 to-transparent" />
                          <div className="relative flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-xl font-bold tracking-tight">{naturalTableNumber}</p>
                                <Badge className={`capitalize ${statusStyles[table.effectiveStatus]}`}>{table.effectiveStatus}</Badge>
                              </div>
                              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{table.table_number}</p>
                              {table.name && <p className="mt-1 text-sm font-medium text-foreground/80">{table.name}</p>}
                            </div>
                            <Button variant="outline" size="sm" onClick={() => openEdit(table)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="mt-4">
                            <TableStatusScene
                              capacity={table.capacity}
                              status={table.effectiveStatus}
                              hasWaiter={!!waiterName}
                            />
                          </div>

                          <div className="mt-4 grid gap-3 rounded-2xl border border-white/70 bg-white/70 p-4 backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4" />
                                <span>{table.area || "Dining Area"}</span>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Users className="h-4 w-4" />
                                <span>{table.capacity} seats</span>
                              </div>
                            </div>

                            <div className="rounded-xl bg-slate-950/[0.03] p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Service Coverage
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <User className="h-4 w-4 text-primary" />
                                <p className="text-sm font-medium">{serviceLabel}</p>
                              </div>
                              {table.activeOrder?.order_number && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Live order: <span className="font-semibold text-foreground">{table.activeOrder.order_number}</span>
                                </p>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-3">
                              <Badge variant={table.is_active ? "default" : "secondary"}>
                                {table.is_active ? "Active" : "Inactive"}
                              </Badge>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteTable.mutate(table.id)}
                                disabled={deleteTable.isPending || !!table.activeOrder}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove
                              </Button>
                            </div>

                            {table.notes && <p className="text-xs text-muted-foreground">{table.notes}</p>}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Table Registry</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-8 text-center text-muted-foreground">Loading hotel tables...</p>
            ) : filteredTables.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">No tables found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Table Number</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Waiter</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTables.map((table) => (
                    <TableRow key={table.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{formatTableNumber(table.table_number)}</p>
                          <p className="text-xs text-muted-foreground">{table.table_number}</p>
                          {table.name && <p className="text-xs text-muted-foreground">{table.name}</p>}
                        </div>
                      </TableCell>
                      <TableCell>{table.area || "-"}</TableCell>
                      <TableCell>{table.capacity}</TableCell>
                      <TableCell>
                        {getWaiterName(table.activeOrder) ? (
                          <div>
                            <p className="font-medium">{getWaiterName(table.activeOrder)}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {table.effectiveStatus === "reserved" ? "Reserved by waiter" : "Serving waiter"}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={table.activeOrder ? table.effectiveStatus : table.status}
                          disabled={!!table.activeOrder || updateTableStatus.isPending}
                          onValueChange={(value: HotelTableStatus) =>
                            updateTableStatus.mutate({ id: table.id, status: value })
                          }
                        >
                          <SelectTrigger className={`w-36 ${statusStyles[table.activeOrder ? table.effectiveStatus : table.status]}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TABLE_STATUSES.map((status) => (
                              <SelectItem key={status} value={status} className="capitalize">
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge variant={table.is_active ? "default" : "secondary"}>
                          {table.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">{table.notes || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(table)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteTable.mutate(table.id)}
                            disabled={deleteTable.isPending || !!table.activeOrder}
                          >
                            <Trash2 className="h-4 w-4" />
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
    </Layout>
  );
}
