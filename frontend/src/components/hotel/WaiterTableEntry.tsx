import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { useHotelTables } from "@/hooks/useHotelTables";
import { useTableOccupancyOrders } from "@/hooks/useHotelOrders";
import { resetBackendReachable } from "@/integrations/supabase/client";
import {
  canManageHotelTable,
  getEffectiveHotelTableStatus,
  grantWaiterPosAccess,
  isTableOccupyingOrderStatus,
} from "@/lib/hotelAccess";
import { TableStatusScene } from "@/components/hotel/TableStatusScene";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HotelTable, HotelTableStatus } from "@/types/hotel";
import { ArrowRight, CheckCircle2, Loader2, Lock, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const normalizeTableNumber = (value?: string | null) => (value || "").trim().toUpperCase();
const preloadHotelPOS = () => import("@/pages/hotel/HotelPOS");

const tableStatusStyles: Record<HotelTableStatus, string> = {
  free: "border-emerald-200 bg-emerald-50 text-emerald-700",
  reserved: "border-amber-200 bg-amber-50 text-amber-700",
  occupied: "border-rose-200 bg-rose-50 text-rose-700",
  cleaning: "border-slate-200 bg-slate-100 text-slate-700",
};

const tableCardStyles: Record<HotelTableStatus, string> = {
  free: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50",
  reserved: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50",
  occupied: "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50",
  cleaning: "border-slate-200 bg-gradient-to-br from-slate-100 via-white to-slate-50",
};

const TABLE_CLEANING_DURATION_MS = 60 * 1000;

const getCleaningRemainingMs = (table: HotelTable, now: number) => {
  const startedAt = table.cleaning_started_at || table.updated_at || table.created_at;
  return Math.max(0, TABLE_CLEANING_DURATION_MS - (now - new Date(startedAt).getTime()));
};

const getCleaningCountdown = (table: HotelTable, now: number) => {
  const remainingMs = getCleaningRemainingMs(table, now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const getInitials = (name?: string | null) =>
  (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

const WAITER_TABLE_ENTRY_KEY = "waiterTableEntry";

export function WaiterTableEntry() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { activeStaff, loginWithPin, verifyPinOnly } = useStaffSession();
  const { data: tables = [], isLoading } = useHotelTables(false, { refetchIntervalMs: 15000 });
  const { data: occupancyOrders = [] } = useTableOccupancyOrders(true, { refetchIntervalMs: 15000 });

  const [selectedTable, setSelectedTable] = useState<HotelTable | null>(null);
  const [tableAccessPin, setTableAccessPin] = useState("");
  const [showTablePinDialog, setShowTablePinDialog] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    void preloadHotelPOS();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const tableOrderMap = useMemo(() => {
    const map = new Map<string, (typeof occupancyOrders)[number]>();
    occupancyOrders.forEach((order) => {
      const keys = [
        order.table_id ? `id:${order.table_id}` : null,
        normalizeTableNumber(order.table_number) ? `num:${normalizeTableNumber(order.table_number)}` : null,
      ].filter(Boolean) as string[];
      if (keys.length === 0) return;
      const orderTime = new Date(order.updated_at || order.created_at).getTime();
      keys.forEach((key) => {
        const existing = map.get(key);
        const existingTime = existing ? new Date(existing.updated_at || existing.created_at).getTime() : 0;
        if (!existing || orderTime >= existingTime) map.set(key, order);
      });
    });
    return map;
  }, [occupancyOrders]);

  const tableLookupMap = useMemo(() => {
    const map = new Map<string, HotelTable>();
    tables.forEach((table) => {
      map.set(`id:${table.id}`, table);
      const n = normalizeTableNumber(table.table_number);
      if (n) map.set(`num:${n}`, table);
    });
    return map;
  }, [tables]);

  const getLinkedOrderForTable = useCallback(
    (table?: Pick<HotelTable, "id" | "table_number"> | null) => {
      if (!table) return null;
      return (
        tableOrderMap.get(`id:${table.id}`) ||
        tableOrderMap.get(`num:${normalizeTableNumber(table.table_number)}`) ||
        null
      );
    },
    [tableOrderMap]
  );

  const tableSelectionCards = useMemo(() => {
    return [...tables]
      .map((table) => {
        const linkedOrder = getLinkedOrderForTable(table);
        const effectiveStatus = getEffectiveHotelTableStatus(table.status, linkedOrder);
        const displayWaiter = linkedOrder?.waiter || linkedOrder?.assigned_waiter;
        const waiterName = displayWaiter
          ? `${displayWaiter.first_name} ${displayWaiter.last_name}`.trim()
          : "";
        return { table, linkedOrder, effectiveStatus, waiterName };
      })
      .sort((a, b) => a.table.table_number.localeCompare(b.table.table_number));
  }, [getLinkedOrderForTable, tables]);

  const { available: availableTableCount, occupied: occupiedTableCount } = useMemo(() => {
    return tableSelectionCards.reduce(
      (acc, { effectiveStatus }) => {
        if (effectiveStatus === "occupied") acc.occupied += 1;
        if (effectiveStatus === "free" || effectiveStatus === "reserved") acc.available += 1;
        return acc;
      },
      { available: 0, occupied: 0 }
    );
  }, [tableSelectionCards]);

  const resolvedSelectedTable = useMemo(() => {
    if (!selectedTable) return null;
    return (
      tableLookupMap.get(`id:${selectedTable.id}`) ||
      tableLookupMap.get(`num:${normalizeTableNumber(selectedTable.table_number)}`) ||
      selectedTable
    );
  }, [selectedTable, tableLookupMap]);

  const handleSelectTable = (table: HotelTable, canUseTable: boolean) => {
    if (!canUseTable) { toast.error("This table is currently unavailable"); return; }
    setSelectedTable(table);
    setTableAccessPin("");
    setShowTablePinDialog(true);
  };

  const handleLoginAndContinue = async () => {
    if (isSubmittingRef.current) return;
    if (!resolvedSelectedTable) { toast.error("Choose a table first"); return; }
    if (tableAccessPin.length < 4) { toast.error("PIN must be at least 4 digits"); return; }

    isSubmittingRef.current = true;
    setIsLoggingIn(true);

    const linkedOrder = getLinkedOrderForTable(resolvedSelectedTable);
    const effectiveStatus = getEffectiveHotelTableStatus(resolvedSelectedTable.status, linkedOrder);

    if (effectiveStatus === "cleaning") {
      isSubmittingRef.current = false; setIsLoggingIn(false); setTableAccessPin("");
      toast.error("This table is still in cleaning mode"); return;
    }

    const expectedStaffId =
      linkedOrder?.waiter_id ||
      linkedOrder?.assigned_waiter_id ||
      linkedOrder?.staff_id ||
      null;
    const check = await verifyPinOnly(tableAccessPin, { expectedStaffId, waiterOnly: true });

    if (!check.success) {
      isSubmittingRef.current = false; setIsLoggingIn(false); setTableAccessPin("");
      toast.error(check.error || "Invalid PIN"); return;
    }

    if (!canManageHotelTable(check.staff, linkedOrder)) {
      isSubmittingRef.current = false; setIsLoggingIn(false); setTableAccessPin("");
      toast.error("Only the waiter who opened this occupied table can reopen it"); return;
    }

    const result = await loginWithPin(tableAccessPin, { verification: check });
    isSubmittingRef.current = false;
    setIsLoggingIn(false);

    if (!result.success) {
      setTableAccessPin("");
      toast.error(result.error || "Login failed"); return;
    }

    grantWaiterPosAccess({
      staffId: result.staff!.staff_id,
      tableId: resolvedSelectedTable.id,
      tableNumber: resolvedSelectedTable.table_number,
    });

    try {
      sessionStorage.setItem(
        WAITER_TABLE_ENTRY_KEY,
        JSON.stringify({
          staffId: result.staff!.staff_id,
          tableId: resolvedSelectedTable.id,
          tableNumber: resolvedSelectedTable.table_number,
          grantedAt: Date.now(),
        })
      );
    } catch { /* sessionStorage unavailable */ }

    toast.success(`Table ${resolvedSelectedTable.table_number} ready`);
    navigate("/restaurant/pos", {
      replace: true,
      state: {
        tableEntry: {
          staffId: result.staff!.staff_id,
          tableId: resolvedSelectedTable.id,
          tableNumber: resolvedSelectedTable.table_number,
        },
      },
    });
  };

  // Auto-submit on 6 digits
  useEffect(() => {
    if (showTablePinDialog && tableAccessPin.length === 6 && !isLoggingIn) {
      void handleLoginAndContinue();
    }
  }, [tableAccessPin, showTablePinDialog, isLoggingIn]);

  // Keyboard PIN entry
  useEffect(() => {
    if (!showTablePinDialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        if (tableAccessPin.length < 6) setTableAccessPin((prev) => prev + e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setTableAccessPin((prev) => prev.slice(0, -1));
      } else if (e.key === "Enter" && tableAccessPin.length >= 4 && !isLoggingIn) {
        e.preventDefault();
        void handleLoginAndContinue();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showTablePinDialog, tableAccessPin, isLoggingIn]);

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        {/* Title */}
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-slate-900 sm:text-xl">
            Choose Service Table
          </h1>
          <p className="hidden text-xs text-slate-500 sm:block">
            Select a table to manage orders and service.
          </p>
        </div>

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Stats */}
          <div className="flex gap-2">
            <div className="flex flex-col items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 sm:px-4 sm:py-2">
              <p className="text-sm font-bold leading-none text-emerald-700 sm:text-lg">{availableTableCount}</p>
              <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-emerald-600 sm:text-[10px]">
                Available
              </p>
            </div>
            <div className="flex flex-col items-center rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 sm:px-4 sm:py-2">
              <p className="text-sm font-bold leading-none text-rose-700 sm:text-lg">{occupiedTableCount}</p>
              <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-rose-600 sm:text-[10px]">
                Occupied
              </p>
            </div>
          </div>

          {/* Refresh – hidden on very small screens */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { resetBackendReachable(); window.location.reload(); }}
            className="hidden h-9 gap-1.5 border-slate-200 sm:flex"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
              Refresh
            </span>
          </Button>

          {/* Sign out */}
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="h-9 gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </Button>
        </div>
      </header>

      {/* ── Table grid ─────────────────────────────────────────────────── */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-slate-300" />
            <p className="text-sm font-medium text-slate-400">Loading tables…</p>
          </div>
        ) : tableSelectionCards.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:gap-4 sm:p-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {tableSelectionCards.map(({ table, linkedOrder, effectiveStatus, waiterName }) => {
              const isSelected =
                normalizeTableNumber(selectedTable?.table_number) ===
                normalizeTableNumber(table.table_number);
              const canUseTable = effectiveStatus !== "cleaning";
              const visualStatus = effectiveStatus as HotelTableStatus;
              const cleaningCountdown =
                visualStatus === "cleaning" ? getCleaningCountdown(table, countdownNow) : null;
              const isCleaningAlmostDone =
                visualStatus === "cleaning" && getCleaningRemainingMs(table, countdownNow) <= 10_000;
              const ownedByActiveWaiter = linkedOrder
                ? canManageHotelTable(activeStaff, linkedOrder)
                : false;

              return (
                <button
                  key={table.id}
                  type="button"
                  onMouseEnter={() => canUseTable && void preloadHotelPOS()}
                  onPointerEnter={() => canUseTable && void preloadHotelPOS()}
                  onClick={() => handleSelectTable(table, canUseTable)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectTable(table, canUseTable);
                    }
                  }}
                  disabled={!canUseTable}
                  className={cn(
                    "cursor-pointer touch-manipulation select-none overflow-hidden rounded-xl border text-left shadow-sm transition-all duration-75",
                    "active:scale-[0.985] active:shadow-md",
                    tableCardStyles[visualStatus],
                    isSelected &&
                      "border-primary ring-2 ring-primary/20 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]",
                    canUseTable && !isSelected &&
                      "hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40",
                    !canUseTable && "cursor-not-allowed opacity-60 grayscale-[0.1]"
                  )}
                >
                  <div className="relative p-3">
                    {/* Shine */}
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/60 to-transparent" />

                    {/* Header */}
                    <div className="relative flex items-start justify-between gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <p className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
                            {table.table_number}
                          </p>
                          <Badge
                            className={cn(
                              "shrink-0 px-1.5 py-0 text-[9px] capitalize sm:text-[10px]",
                              tableStatusStyles[visualStatus]
                            )}
                          >
                            {visualStatus}
                          </Badge>
                        </div>
                        <p className="truncate text-[9px] uppercase tracking-[0.14em] text-slate-500">
                          {table.name || table.area || "Dining Table"}
                        </p>

                        {/* Waiter chip */}
                        {waiterName && (
                          <span
                            className={cn(
                              "mt-1 inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold",
                              linkedOrder
                                ? ownedByActiveWaiter
                                  ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
                                  : "border-amber-200 bg-amber-50/90 text-amber-700"
                                : "border-slate-200 bg-white/85 text-slate-700"
                            )}
                          >
                            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-black/5 text-[8px] font-bold">
                              {getInitials(waiterName)}
                            </span>
                            <span className="truncate">{ownedByActiveWaiter ? "You" : waiterName}</span>
                            {linkedOrder && !ownedByActiveWaiter && (
                              <Lock className="h-2.5 w-2.5 shrink-0" />
                            )}
                          </span>
                        )}
                      </div>

                      {/* Right badges */}
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {isSelected && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-primary">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            <span className="hidden sm:inline">Selected</span>
                          </span>
                        )}
                        {cleaningCountdown && (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border bg-white/85 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums",
                              isCleaningAlmostDone
                                ? "border-emerald-300 text-emerald-700"
                                : "border-slate-300 text-slate-600"
                            )}
                          >
                            {cleaningCountdown}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Table illustration */}
                    <div className="relative mt-2 flex justify-center">
                      <TableStatusScene
                        capacity={table.capacity}
                        status={visualStatus}
                        hasWaiter={!!linkedOrder}
                        className="w-full max-w-[110px] sm:max-w-[130px]"
                        svgClassName="h-[72px] sm:h-[88px]"
                      />
                    </div>

                    {/* Info panel */}
                    <div className="mt-2 rounded-lg border border-white/70 bg-white/70 p-2 backdrop-blur">
                      <div className="flex items-center justify-between gap-1 text-[9px] text-slate-500 sm:text-[10px]">
                        <span className="truncate">{table.area || "Dining Area"}</span>
                        <span className="shrink-0 font-medium">{table.capacity} seats</span>
                      </div>
                      {waiterName && (
                        <p className="mt-0.5 truncate text-[9px] font-semibold text-slate-600 sm:text-[10px]">
                          Waiter: <span className="text-slate-900">{waiterName}</span>
                        </p>
                      )}
                      <p className="mt-1 text-[10px] font-medium leading-tight text-slate-700 sm:text-[11px]">
                        {visualStatus === "occupied"
                          ? waiterName
                            ? `${waiterName} is serving. Only they can reopen.`
                            : "Verify PIN — only the opener can reopen."
                          : visualStatus === "reserved"
                            ? "Reserved — ready for service"
                            : visualStatus === "cleaning"
                              ? `Cleaning • free in ${cleaningCountdown}`
                              : "Available for a new order"}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="rounded-full bg-slate-100 p-6">
              <RefreshCw className="h-10 w-10 text-slate-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">No Tables Found</h3>
              <p className="mt-1 max-w-xs text-sm text-slate-500">
                We couldn't load the service tables. This might be a connection issue.
              </p>
            </div>
            <Button
              onClick={() => { resetBackendReachable(); window.location.reload(); }}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Retry Connection
            </Button>
          </div>
        )}
      </main>

      {/* ── PIN Dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={showTablePinDialog && !!resolvedSelectedTable}
        onOpenChange={(open) => {
          setShowTablePinDialog(open);
          if (!open) {
            setTableAccessPin("");
            isSubmittingRef.current = false;
            setIsLoggingIn(false);
          }
        }}
      >
        <DialogContent className="w-[92vw] max-w-md rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_28px_80px_rgba(15,23,42,0.24)]">
          <div className="border-b border-slate-200 bg-gradient-to-r from-rose-50/60 via-white to-violet-50/60 px-5 py-4">
            <DialogTitle className="text-lg font-bold text-slate-900">Waiter Access Check</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-500">
              Enter your PIN to continue with the selected table.
            </DialogDescription>
          </div>

          {resolvedSelectedTable && (
            <form
              onSubmit={(e) => { e.preventDefault(); void handleLoginAndContinue(); }}
              className="space-y-5 p-5"
            >
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <div className="p-4">
                  {(() => {
                    const selectedLinkedOrder = getLinkedOrderForTable(resolvedSelectedTable);
                    const selectedEffectiveStatus = getEffectiveHotelTableStatus(
                      resolvedSelectedTable.status,
                      selectedLinkedOrder
                    ) as HotelTableStatus;
                    return (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-2xl font-bold text-slate-900">
                              {resolvedSelectedTable.table_number}
                            </p>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              {resolvedSelectedTable.name || resolvedSelectedTable.area || "Dining Table"}
                            </p>
                          </div>
                          <Badge className={cn("capitalize", tableStatusStyles[selectedEffectiveStatus])}>
                            {selectedEffectiveStatus}
                          </Badge>
                        </div>
                        <div className="mt-3">
                          <TableStatusScene
                            capacity={resolvedSelectedTable.capacity}
                            status={selectedEffectiveStatus}
                            hasWaiter={!!selectedLinkedOrder}
                            className="max-w-[170px]"
                            svgClassName="h-[110px]"
                          />
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="waiter-entry-pin"
                  className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                >
                  Waiter PIN
                </Label>
                <Input
                  id="waiter-entry-pin"
                  type="password"
                  autoComplete="new-password"
                  inputMode="numeric"
                  autoFocus
                  maxLength={6}
                  value={tableAccessPin}
                  onChange={(e) => setTableAccessPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter your PIN"
                  className="h-12 rounded-xl text-lg font-semibold tracking-[0.2em]"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setShowTablePinDialog(false); setTableAccessPin(""); }}
                  className="h-12 flex-1 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!resolvedSelectedTable || isLoggingIn}
                  className="h-12 flex-1 gap-2 rounded-xl text-[12px] font-semibold uppercase tracking-[0.12em]"
                >
                  {isLoggingIn
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <ArrowRight className="h-4 w-4" />}
                  Continue
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
