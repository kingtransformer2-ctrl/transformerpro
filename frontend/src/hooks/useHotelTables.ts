import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HotelOrder, HotelTable, HotelTableStatus } from "@/types/hotel";
import { toast } from "sonner";
import {
  addToSyncQueue,
  deleteLocalData,
  getLocalData,
  getSyncQueue,
  removeFromSyncQueue,
  saveLocalData,
  type SyncQueueItem,
} from "@/lib/localDataService";
import { syncService } from "@/lib/syncService";
import { isTableOccupyingOrderStatus } from "@/lib/hotelAccess";

type HotelTablePayload = {
  table_number: string;
  name?: string | null;
  area?: string | null;
  capacity?: number;
  status?: HotelTableStatus;
  cleaning_started_at?: string | null;
  notes?: string | null;
  is_active?: boolean;
};

type UseHotelTablesOptions = {
  enabled?: boolean;
  refetchIntervalMs?: number | false;
};

const TABLE_CLEANING_DURATION_MS = 60 * 1000;
const WAITER_TABLE_ENTRY_KEY = "waiterTableEntry";
const STARTER_HOTEL_TABLE_BLUEPRINTS: Array<Omit<HotelTable, "updated_at"> & { legacy_id: string }> = [
  {
    legacy_id: "starter-table-t01",
    id: "a4d4e083-6cc6-4fb0-bc2f-4afaa5c7d011",
    table_number: "T-01",
    name: "Window Two-Seater",
    area: "Main Dining",
    capacity: 2,
    status: "free",
    cleaning_started_at: null,
    notes: "Auto-created starter table.",
    is_active: true,
    created_at: "2026-05-29T00:00:00.000Z",
  },
  {
    legacy_id: "starter-table-t02",
    id: "fd30228a-7ec4-45cb-a18a-f80c43652d7d",
    table_number: "T-02",
    name: "Family Booth",
    area: "Main Dining",
    capacity: 4,
    status: "free",
    cleaning_started_at: null,
    notes: "Auto-created starter table.",
    is_active: true,
    created_at: "2026-05-29T00:00:00.000Z",
  },
  {
    legacy_id: "starter-table-t03",
    id: "d33e0f7d-30ce-4787-9122-b4d3d81cfffe",
    table_number: "T-03",
    name: "Corner Four-Seater",
    area: "Main Dining",
    capacity: 4,
    status: "free",
    cleaning_started_at: null,
    notes: "Auto-created starter table.",
    is_active: true,
    created_at: "2026-05-29T00:00:00.000Z",
  },
  {
    legacy_id: "starter-table-t04",
    id: "86d7f6b0-8cb8-4fd5-8e12-0c67bf1b1fd3",
    table_number: "T-04",
    name: "Service Table Near POS",
    area: "Main Dining",
    capacity: 4,
    status: "free",
    cleaning_started_at: null,
    notes: "Auto-created starter table.",
    is_active: true,
    created_at: "2026-05-29T00:00:00.000Z",
  },
  {
    legacy_id: "starter-table-t05",
    id: "0f0d8f9d-447f-4c09-bf18-d0eb89cdf21f",
    table_number: "T-05",
    name: "Garden View Table",
    area: "Terrace",
    capacity: 4,
    status: "free",
    cleaning_started_at: null,
    notes: "Auto-created starter table.",
    is_active: true,
    created_at: "2026-05-29T00:00:00.000Z",
  },
  {
    legacy_id: "starter-table-t06",
    id: "542577c4-f154-49ad-baeb-dfd02c1649bb",
    table_number: "T-06",
    name: "VIP Round Table",
    area: "VIP Lounge",
    capacity: 6,
    status: "free",
    cleaning_started_at: null,
    notes: "Auto-created starter table.",
    is_active: true,
    created_at: "2026-05-29T00:00:00.000Z",
  },
];
const STARTER_HOTEL_TABLES: Array<Omit<HotelTable, "updated_at">> = STARTER_HOTEL_TABLE_BLUEPRINTS.map(
  ({ legacy_id: _legacyId, ...table }) => table
);
const LEGACY_STARTER_TABLE_ID_MAP = new Map(
  STARTER_HOTEL_TABLE_BLUEPRINTS.map(({ legacy_id, id }) => [legacy_id, id])
);

function remapLegacyStarterTableId(value?: string | null) {
  if (!value) return value ?? null;
  return LEGACY_STARTER_TABLE_ID_MAP.get(value) || value;
}

async function remapStoredWaiterAccessState() {
  if (typeof window === "undefined") {
    return false;
  }

  let changed = false;

  try {
    const waiterEntry = window.sessionStorage.getItem(WAITER_TABLE_ENTRY_KEY);
    if (waiterEntry) {
      const parsed = JSON.parse(waiterEntry) as { tableId?: string };
      const nextTableId = remapLegacyStarterTableId(parsed.tableId);
      if (nextTableId && nextTableId !== parsed.tableId) {
        window.sessionStorage.setItem(
          WAITER_TABLE_ENTRY_KEY,
          JSON.stringify({
            ...parsed,
            tableId: nextTableId,
          })
        );
        changed = true;
      }
    }
  } catch {
    // Ignore malformed sessionStorage payloads.
  }

  try {
    const waiterAccess = window.sessionStorage.getItem("hotel.waiterPosAccess");
    if (waiterAccess) {
      const parsed = JSON.parse(waiterAccess) as { tableId?: string };
      const nextTableId = remapLegacyStarterTableId(parsed.tableId);
      if (nextTableId && nextTableId !== parsed.tableId) {
        window.sessionStorage.setItem(
          "hotel.waiterPosAccess",
          JSON.stringify({
            ...parsed,
            tableId: nextTableId,
          })
        );
        changed = true;
      }
    }
  } catch {
    // Ignore malformed sessionStorage payloads.
  }

  return changed;
}

async function migrateLegacyStarterTableIds(seedTables?: HotelTable[]) {
  const now = new Date().toISOString();
  const tables = seedTables || (await getLocalData<HotelTable>("hotel_tables"));
  const legacyTables = tables.filter((table) => LEGACY_STARTER_TABLE_ID_MAP.has(table.id));

  // Sanitize any invalid statuses first
  let sanitizedTables = tables.map(table => {
    if (!table.status || !['free', 'reserved', 'occupied', 'cleaning'].includes(table.status)) {
      return { ...table, status: 'free' as HotelTableStatus, updated_at: now };
    }
    return table;
  });
  const needsSanitize = sanitizedTables.some((table, i) => table !== tables[i]);
  if (needsSanitize) {
    await saveLocalData("hotel_tables", sanitizedTables);
  }

  const [orders, sessions, syncQueue] = await Promise.all([
    getLocalData<HotelOrder>("hotel_orders"),
    getLocalData<any>("hotel_table_sessions"),
    getSyncQueue(),
  ]);

  let changed = needsSanitize;
  let nextTables = sanitizedTables;

  if (legacyTables.length > 0) {
    nextTables = nextTables.map((table) => {
      const nextId = remapLegacyStarterTableId(table.id);
      if (nextId !== table.id) {
        changed = true;
        return {
          ...table,
          id: nextId as string,
          updated_at: table.updated_at || now,
        };
      }
      return table;
    });

    await saveLocalData("hotel_tables", nextTables);
    await Promise.all(legacyTables.map((table) => deleteLocalData("hotel_tables", table.id)));
  }

  const nextOrders = orders.map((order) => {
    const nextTableId = remapLegacyStarterTableId(order.table_id);
    if (nextTableId !== order.table_id) {
      changed = true;
      return {
        ...order,
        table_id: nextTableId,
        updated_at: order.updated_at || now,
      };
    }
    return order;
  });

  if (nextOrders.some((order, index) => order !== orders[index])) {
    await saveLocalData("hotel_orders", nextOrders);
  }

  const nextSessions = sessions.map((session) => {
    const nextTableId = remapLegacyStarterTableId(session.table_id);
    if (nextTableId !== session.table_id) {
      changed = true;
      return {
        ...session,
        table_id: nextTableId,
        updated_at: session.updated_at || now,
      };
    }
    return session;
  });

  if (nextSessions.some((session, index) => session !== sessions[index])) {
    await saveLocalData("hotel_table_sessions", nextSessions);
  }

  const queueUpdates: Array<{ previousId: string; nextItem: SyncQueueItem }> = [];
  for (const item of syncQueue) {
    let nextData = item.data;
    let changedItem = false;

    if (item.table === "hotel_tables" && typeof nextData?.id === "string") {
      const nextId = remapLegacyStarterTableId(nextData.id);
      if (nextId !== nextData.id) {
        nextData = { ...nextData, id: nextId };
        changedItem = true;
      }
    }

    if (typeof nextData?.table_id === "string") {
      const nextTableId = remapLegacyStarterTableId(nextData.table_id);
      if (nextTableId !== nextData.table_id) {
        nextData = { ...nextData, table_id: nextTableId };
        changedItem = true;
      }
    }

    if (typeof nextData?.tableId === "string") {
      const nextTableId = remapLegacyStarterTableId(nextData.tableId);
      if (nextTableId !== nextData.tableId) {
        nextData = { ...nextData, tableId: nextTableId };
        changedItem = true;
      }
    }

    if (changedItem) {
      changed = true;
      const nextQueueId =
        item.table === "hotel_tables" && typeof nextData?.id === "string"
          ? `${item.table}_${nextData.id}_${item.timestamp}`
          : item.id;

      queueUpdates.push({
        previousId: item.id,
        nextItem: {
          ...item,
          id: nextQueueId,
          data: nextData,
        },
      });
    }
  }

  if (queueUpdates.length > 0) {
    for (const update of queueUpdates) {
      await removeFromSyncQueue(update.previousId);
    }
    for (const update of queueUpdates) {
      await addToSyncQueue(update.nextItem);
    }
  }

  const storageChanged = await remapStoredWaiterAccessState();
  changed = changed || storageChanged;

  if (changed) {
    console.info("[useHotelTables] Migrated legacy starter table IDs to UUIDs.");
  }

  return nextTables;
}

async function ensureStarterHotelTables() {
  const timestamp = new Date().toISOString();

  await Promise.all(
    STARTER_HOTEL_TABLES.map((table) =>
      syncService.performOperation("hotel_tables", "insert", {
        ...table,
        updated_at: timestamp,
      })
    )
  );

  return STARTER_HOTEL_TABLES.map((table) => ({
    ...table,
    updated_at: timestamp,
  })) as HotelTable[];
}

function normalizeTableNumber(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function getCleaningStartedAt(table: HotelTable) {
  return table.cleaning_started_at || table.updated_at || table.created_at;
}

function isExpiredCleaningTable(table: HotelTable) {
  if (table.status !== "cleaning") return false;
  const startedAt = getCleaningStartedAt(table);
  if (!startedAt) return false;
  return Date.now() - new Date(startedAt).getTime() >= TABLE_CLEANING_DURATION_MS;
}

async function releaseExpiredCleaningTables(tables: HotelTable[]) {
  const expiredTables = tables.filter(isExpiredCleaningTable);
  if (expiredTables.length === 0) {
    return tables;
  }

  const releasedAt = new Date().toISOString();

  // IMPORTANT: use allSettled, not all. If one table's update fails (e.g. a
  // transient network/server error), Promise.all would reject the whole
  // batch, which throws out of this function, which throws out of the
  // useHotelTables queryFn, which puts the ENTIRE tables query into an error
  // state for every screen using it — triggering React Query's automatic
  // retry loop and a flood of repeated failing requests. allSettled lets
  // each table succeed or fail independently: successful releases still
  // apply, failed ones are simply retried on the next poll instead of
  // crashing the whole tables list.
  const results = await Promise.allSettled(
    expiredTables.map((table) =>
      syncService.performOperation("hotel_tables", "update", {
        id: table.id,
        status: "free",
        cleaning_started_at: null,
        updated_at: releasedAt,
      })
    )
  );

  const releasedIds = new Set<string>();
  results.forEach((result, index) => {
    const table = expiredTables[index];
    if (result.status === "fulfilled") {
      releasedIds.add(table.id);
    } else {
      console.warn(
        `[releaseExpiredCleaningTables] Failed to release table ${table.id} (${table.table_number ?? "unknown"}); will retry next poll.`,
        result.reason
      );
    }
  });

  return tables.map((table) =>
    releasedIds.has(table.id)
      ? {
          ...table,
          status: "free",
          cleaning_started_at: null,
          updated_at: releasedAt,
        }
      : table
  );
}

async function getActiveOccupyingOrderForTable(table: Pick<HotelTable, "id" | "table_number">) {
  const normalizedTableNumber = normalizeTableNumber(table.table_number);
  const orders = await getLocalData<HotelOrder>("hotel_orders");

  return (orders || []).find((order) => {
    if (!isTableOccupyingOrderStatus(order.status)) {
      return false;
    }

    return (
      order.table_id === table.id ||
      normalizeTableNumber(order.table_number) === normalizedTableNumber
    );
  }) || null;
}

export function useHotelTables(includeInactive = true, options?: UseHotelTablesOptions) {
  const enabled = options?.enabled ?? true;
  // NOTE: previously defaulted to 1000ms (polling once per second) for any
  // caller that didn't explicitly override it. That's aggressive enough to
  // cause real backend load/transient failures on its own, independent of
  // any specific bug. Table data doesn't need sub-second freshness; default
  // to a much calmer 15s unless a caller has a specific reason to poll faster.
  const refetchIntervalMs = options?.refetchIntervalMs ?? 15000;

  return useQuery({
    queryKey: ["hotel-tables", includeInactive],
    queryFn: async () => {
      // 1. Initial Load from Local IndexedDB (Instant UI)
      const cached = await getLocalData<HotelTable>("hotel_tables");
      
      // Sanitize any bad statuses in local data first!
      const sanitizedCached = cached.map(table => {
        if (!table.status || !['free', 'reserved', 'occupied', 'cleaning'].includes(table.status)) {
          return { ...table, status: 'free' as HotelTableStatus };
        }
        return table;
      });
      // Save sanitized tables back to local storage
      if (sanitizedCached.length > 0) {
        await saveLocalData("hotel_tables", sanitizedCached);
      }
      
      const migratedCached = await migrateLegacyStarterTableIds(sanitizedCached);
      const initialData = migratedCached || [];

      // 2. Background Sync (latest wins)
      // This updates local storage in the background and returns the latest cloud data if available.
      const cloudData = await syncService.syncFromCloud("hotel_tables");

      let allTables = (cloudData as HotelTable[]) || initialData;

      // 3. Self-heal fresh or offline databases by creating a starter table set.
      if (allTables.length === 0) {
        try {
          allTables = await ensureStarterHotelTables();
          toast.info("Starter service tables were created automatically.");
        } catch (error) {
          console.error("[useHotelTables] Failed to auto-create starter tables.", error);
        }
      }

      let finalData = includeInactive ? allTables : allTables.filter((table) => table.is_active);

      if (finalData.length === 0) {
        console.info("[useHotelTables] No active tables are currently available.");
      }

      return releaseExpiredCleaningTables(finalData);
    },
    staleTime: 0,
    enabled,
    refetchInterval: () => {
      if (!enabled || refetchIntervalMs === false) {
        return false;
      }

      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }

      return refetchIntervalMs;
    },
  });
}

export function useCreateHotelTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: HotelTablePayload) => {
      const data = {
        ...payload,
        id: crypto.randomUUID(),
        table_number: payload.table_number.trim().toUpperCase(),
        cleaning_started_at: payload.status === "cleaning" ? payload.cleaning_started_at || new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await syncService.performOperation("hotel_tables", "insert", data);
      return data as unknown as HotelTable;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hotel-tables"] });
      toast.success("Hotel table created (Saved locally)");
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create table"),
  });
}

export function useUpdateHotelTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: Partial<HotelTablePayload> & { id: string }) => {
      const tables = await getLocalData<HotelTable>("hotel_tables");
      const currentTable = (tables || []).find((table) => table.id === id);
      if (!currentTable) {
        throw new Error("Table not found");
      }

      const activeOrder = await getActiveOccupyingOrderForTable(currentTable);
      const nextTableNumber = normalizeTableNumber(payload.table_number);
      const currentTableNumber = normalizeTableNumber(currentTable.table_number);

      if (activeOrder) {
        if (nextTableNumber && nextTableNumber !== currentTableNumber) {
          throw new Error("Cannot rename a table while it has an active order");
        }

        if (payload.is_active === false && currentTable.is_active) {
          throw new Error("Cannot deactivate a table while it has an active order");
        }

        if (
          payload.status !== undefined &&
          payload.status !== currentTable.status &&
          payload.status !== "occupied"
        ) {
          throw new Error("Cannot change status away from occupied while the table has an active order");
        }
      }

      const updateData = {
        ...payload,
        id,
        table_number: payload.table_number?.trim().toUpperCase(),
        cleaning_started_at:
          payload.status === "cleaning"
            ? payload.cleaning_started_at || new Date().toISOString()
            : payload.status
              ? null
              : payload.cleaning_started_at,
        updated_at: new Date().toISOString(),
      };

      // Defensive sanitization: NEVER allow empty/invalid status to reach DB
      const statusVal = (updateData.status || '').toString().trim().toLowerCase();
      const finalStatus = ['free','reserved','occupied','cleaning'].includes(statusVal)
        ? statusVal as HotelTableStatus
        : 'free' as HotelTableStatus;
      
      const sanitizedUpdate = {
        ...updateData,
        status: finalStatus,
      };

      console.log('[useUpdateHotelTable] Submitting update with status:', sanitizedUpdate.status);
      await syncService.performOperation("hotel_tables", "update", sanitizedUpdate);
      return sanitizedUpdate as unknown as HotelTable;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hotel-tables"] });
      toast.success("Hotel table updated (Saved locally)");
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update table"),
  });
}

export function useDeleteHotelTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const tables = await getLocalData<HotelTable>("hotel_tables");
      const currentTable = (tables || []).find((table) => table.id === id);
      if (!currentTable) {
        throw new Error("Table not found");
      }

      const activeOrder = await getActiveOccupyingOrderForTable(currentTable);
      if (activeOrder) {
        throw new Error("Cannot delete a table while it has an active order");
      }

      await syncService.performOperation("hotel_tables", "delete", { id });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hotel-tables"] });
      toast.success("Hotel table deleted (Saved locally)");
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete table"),
  });
}

export function useUpdateHotelTableStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: HotelTableStatus;
    }) => {
      const tables = await getLocalData<HotelTable>("hotel_tables");
      const currentTable = (tables || []).find((table) => table.id === id);
      if (!currentTable) {
        throw new Error("Table not found");
      }

      const activeOrder = await getActiveOccupyingOrderForTable(currentTable);
      if (activeOrder && status !== "occupied") {
        throw new Error("Cannot change status while the table has an active order");
      }

      const updateData = {
        id,
        status,
        cleaning_started_at: status === "cleaning" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      await syncService.performOperation("hotel_tables", "update", updateData);
      return updateData as unknown as HotelTable;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hotel-tables"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update table status"),
  });
}