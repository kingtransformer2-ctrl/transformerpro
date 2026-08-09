import React, { useState, useMemo } from 'react';
import { Layout } from "@/components/layout/Layout";
import { useStaffShifts, useShiftDetails } from '@/hooks/useHotelShifts';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { useHotelStaff } from '@/hooks/useHotel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ClipboardList, Clock, DollarSign, Activity, ArrowRightLeft, AlertCircle,
  CheckCircle2, FileText, User, Calendar, Filter, UtensilsCrossed, Wine,
  BedDouble, Receipt, TrendingUp, TrendingDown, BarChart3, Package,
  Banknote, CreditCard, Smartphone, Zap, ShieldAlert, Hash
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistance, isSameDay, formatDuration, intervalToDuration } from 'date-fns';

// ── Palette tokens ─────────────────────────────────────────────────
const STATUS = {
  ACTIVE: {
    label: 'Live',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    glow: 'from-emerald-500/12 via-emerald-500/5 to-transparent',
    bar: 'bg-emerald-500',
  },
  CLOSED: {
    label: 'Closed',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    glow: 'from-slate-400/10 via-slate-400/4 to-transparent',
    bar: 'bg-slate-400',
  },
} as const;

// ── Log event typing ────────────────────────────────────────────────
function getLogMeta(actionType: string) {
  const t = actionType.toLowerCase();
  if (t.includes('open'))
    return { Icon: Zap, color: 'text-emerald-600', bg: 'bg-emerald-100', rail: '#10B981', label: 'Open' };
  if (t.includes('close') || t.includes('end'))
    return { Icon: CheckCircle2, color: 'text-slate-500', bg: 'bg-slate-100', rail: '#94A3B8', label: 'Close' };
  if (t.includes('sale') || t.includes('pay'))
    return { Icon: Banknote, color: 'text-cyan-600', bg: 'bg-cyan-100', rail: '#0891B2', label: 'Sale' };
  if (t.includes('refund') || t.includes('cancel'))
    return { Icon: ArrowRightLeft, color: 'text-amber-600', bg: 'bg-amber-100', rail: '#D97706', label: 'Reversal' };
  if (t.includes('checkin') || t.includes('check-in') || t.includes('check_in'))
    return { Icon: BedDouble, color: 'text-violet-600', bg: 'bg-violet-100', rail: '#7C3AED', label: 'Check-in' };
  if (t.includes('checkout') || t.includes('check-out') || t.includes('check_out'))
    return { Icon: BedDouble, color: 'text-orange-600', bg: 'bg-orange-100', rail: '#EA580C', label: 'Check-out' };
  if (t.includes('error') || t.includes('alert') || t.includes('issue'))
    return { Icon: ShieldAlert, color: 'text-red-600', bg: 'bg-red-100', rail: '#DC2626', label: 'Alert' };
  return { Icon: FileText, color: 'text-blue-600', bg: 'bg-blue-100', rail: '#2563EB', label: 'Log' };
}

export default function ShiftReport() {
  const { formatCurrency } = useSettingsContext();
  const { data: shifts, isLoading: shiftsLoading } = useStaffShifts();
  const { data: staffList = [] } = useHotelStaff();
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [activeTab, setActiveTab] = useState('finance');

  const filteredShifts = useMemo(() => {
    if (!shifts) return [];
    let filtered = shifts;
    if (staffFilter !== "all") filtered = filtered.filter(s => s.staff_id === staffFilter);
    if (dateFilter) {
      const filterDate = new Date(dateFilter);
      filtered = filtered.filter(s => isSameDay(new Date(s.opened_at), filterDate));
    }
    return filtered;
  }, [shifts, staffFilter, dateFilter]);

  const { data: details, isLoading: detailsLoading } = useShiftDetails(selectedShiftId || undefined);

  React.useEffect(() => {
    if (filteredShifts && filteredShifts.length > 0 && !selectedShiftId) {
      setSelectedShiftId(filteredShifts[0].id);
    } else if (filteredShifts.length === 0) {
      setSelectedShiftId(null);
    }
  }, [filteredShifts, selectedShiftId]);

  const shift = details?.shift;
  const logs = details?.logs || [];
  const fin = shift?.summary?.financial;
  const orders = shift?.summary?.orders;
  const stations = shift?.summary?.stations;
  const activity = shift?.summary?.hotel_activity;
  const topItems = shift?.summary?.inventory?.top_items || [];
  const issues = shift?.summary?.issues || [];

  const variance = Number(fin?.difference || 0);
  const variantState =
    variance === 0 ? { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 className="h-4 w-4 shrink-0" />, label: 'Balanced' } :
    variance > 0   ? { color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: <TrendingUp className="h-4 w-4 shrink-0" />, label: 'Surplus' } :
                     { color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <TrendingDown className="h-4 w-4 shrink-0" />, label: 'Shortfall' };

  const shiftStatus = (shift?.status ?? 'CLOSED') as keyof typeof STATUS;
  const statusCfg = STATUS[shiftStatus] ?? STATUS.CLOSED;

  const shiftDuration = shift?.opened_at && shift?.closed_at
    ? formatDuration(intervalToDuration({ start: new Date(shift.opened_at), end: new Date(shift.closed_at) }), { format: ['hours', 'minutes'] })
    : shift?.opened_at ? formatDistance(new Date(shift.opened_at), new Date()) + ' elapsed' : null;

  // ── TABS definition ─────────────────────────────────────────────
  const tabs = [
    { value: 'finance',  icon: Banknote,        label: 'Financials' },
    { value: 'orders',   icon: Receipt,         label: 'Orders' },
    { value: 'stations', icon: UtensilsCrossed, label: 'Kitchen & Bar' },
    { value: 'activity', icon: BarChart3,       label: 'Activity' },
  ];

  return (
    <Layout disableScroll={true}>
      <div className="h-full flex flex-col bg-slate-50 overflow-hidden">

        {/* ── PAGE HEADER ─────────────────────────────────────────── */}
        <div className="shrink-0 bg-white border-b border-slate-200 px-5 py-4 md:px-8">
          <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-cyan-600 flex items-center justify-center shrink-0 shadow-sm shadow-cyan-200">
                <ClipboardList className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-slate-900 leading-none">Shift Report</h1>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Live activity, financials and audit log</p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Staff filter */}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 h-9 shadow-sm">
                <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <Select value={staffFilter} onValueChange={setStaffFilter}>
                  <SelectTrigger className="h-7 border-none bg-transparent shadow-none focus:ring-0 text-xs font-semibold text-slate-700 min-w-[120px]">
                    <SelectValue placeholder="All Staff" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Staff</SelectItem>
                    {staffList.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.first_name} {s.last_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date filter */}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 h-9 shadow-sm">
                <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <input
                  type="date"
                  className="bg-transparent border-none text-xs font-semibold text-slate-700 outline-none w-[120px]"
                  value={dateFilter}
                  onChange={e => setDateFilter(e.target.value)}
                />
                {dateFilter && (
                  <button onClick={() => setDateFilter("")} className="text-[10px] font-bold text-slate-400 hover:text-slate-700 transition-colors uppercase tracking-wide">✕</button>
                )}
              </div>

              {/* Shift selector */}
              <Select
                value={selectedShiftId || undefined}
                onValueChange={v => { setSelectedShiftId(v); setActiveTab('finance'); }}
                disabled={filteredShifts.length === 0}
              >
                <SelectTrigger className="h-9 min-w-[220px] rounded-lg border border-cyan-200 bg-cyan-50 text-xs font-bold text-cyan-800 shadow-sm focus:ring-2 focus:ring-cyan-200">
                  <SelectValue placeholder={shiftsLoading ? "Loading shifts…" : filteredShifts.length === 0 ? "No shifts found" : "Select a shift"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredShifts.map(s => (
                    <SelectItem key={s.id} value={s.id}>
  <div className="flex items-center gap-3">
    <span className="font-semibold">
      {s.staff ? `${s.staff.first_name} ${s.staff.last_name}` : s.shift_label}
    </span>
    <span className="text-[10px] text-slate-400 font-mono">{format(new Date(s.opened_at), 'MMM d, HH:mm')}</span>
  </div>
</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* ── BODY ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-0 overflow-hidden max-w-[1600px] mx-auto w-full">

          {/* ── LEFT PANEL ──────────────────────────────────────────── */}
          <div className="w-full lg:w-[400px] xl:w-[440px] shrink-0 flex flex-col border-r border-slate-200 bg-white overflow-hidden">
            {detailsLoading ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-8 w-3/4 rounded-lg" />
                <Skeleton className="h-64 w-full rounded-xl" />
              </div>
            ) : !shift ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-10 text-slate-400">
                <ClipboardList className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-sm font-bold">No shift selected</p>
                <p className="text-xs mt-1">Pick a shift above to view its details</p>
              </div>
            ) : (
              <ScrollArea className="flex-1">
                {/* ── Shift hero ──────────────────────────────────────── */}
                <div className={cn(
                  "relative px-5 pt-5 pb-4 border-b border-slate-100 overflow-hidden",
                )}>
                  {/* Status glow strip */}
                  <div className={cn("absolute top-0 left-0 right-0 h-0.5", statusCfg.bar)} />
                  <div className={cn("absolute inset-0 bg-gradient-to-b pointer-events-none", statusCfg.glow)} />

                  <div className="relative space-y-3">
                    {/* Status + Staff row */}
                    <div className="flex items-center justify-between">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em] px-2.5 py-1 rounded-full border",
                        statusCfg.badge
                      )}>
                        <span className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          statusCfg.dot,
                          shiftStatus === 'ACTIVE' && "animate-pulse"
                        )} />
                        {statusCfg.label}
                      </div>
                      {shift.staff && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                          <User className="h-3 w-3 text-slate-400" />
                          {shift.staff.first_name} {shift.staff.last_name}
                        </span>
                      )}
                    </div>

                    {/* Shift label */}
                    <div>
                     <h2 className="text-xl font-black text-slate-900 tracking-tight leading-none">
  {shift.staff ? `${shift.staff.first_name} ${shift.staff.last_name}'s Shift` : shift.shift_label}
</h2>
                      <p className="text-xs text-slate-400 font-medium mt-1">
                        {format(new Date(shift.opened_at), 'EEEE, MMMM d, yyyy')}
                      </p>
                    </div>

                    {/* Time row */}
                    <div className="grid grid-cols-3 gap-2">
                      <TimeChip icon={<Clock className="h-3 w-3" />} label="Opened" value={format(new Date(shift.opened_at), 'HH:mm')} />
                      <TimeChip icon={<CheckCircle2 className="h-3 w-3" />} label="Closed" value={shift.closed_at ? format(new Date(shift.closed_at), 'HH:mm') : '—'} active={shiftStatus === 'ACTIVE'} />
                      <TimeChip icon={<Hash className="h-3 w-3" />} label="Duration" value={shiftDuration ?? '—'} small />
                    </div>

                    {/* Expected cash hero */}
                    {fin && (
                      <div className="mt-1 rounded-xl bg-slate-900 p-4 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/40 to-transparent pointer-events-none" />
                        <div className="relative">
                          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-0.5">Expected in Drawer</p>
                          <p className="text-3xl font-black text-cyan-400 tabular-nums tracking-tighter">
                            {formatCurrency(fin?.expected_cash || 0)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Issues banner ────────────────────────────────────── */}
                {issues.length > 0 && (
                  <div className="mx-5 mt-4 rounded-xl bg-red-50 border border-red-200 p-3.5">
                    <div className="flex items-center gap-2 text-red-700 mb-2">
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      <span className="text-xs font-black uppercase tracking-wider">Issues Detected</span>
                    </div>
                    <ul className="space-y-1">
                      {issues.map((issue: string, i: number) => (
                        <li key={i} className="text-xs text-red-600 font-medium flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0">·</span>{issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ── Tabs ─────────────────────────────────────────────── */}
                {shift.summary && (
                  <div className="px-5 pt-4 pb-6 space-y-4">
                    {/* Tab pills */}
                    <div className="flex gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto no-scrollbar">
                      {tabs.map(t => (
                        <button
                          key={t.value}
                          onClick={() => setActiveTab(t.value)}
                          className={cn(
                            "flex-1 min-w-max inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap",
                            activeTab === t.value
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-400 hover:text-slate-700"
                          )}
                        >
                          <t.icon className="h-3 w-3 shrink-0" />
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* ── Finance ──────────────────────────────────────── */}
                    {activeTab === 'finance' && fin && (
                      <div className="space-y-2">
                        <FinRow label="Opening Float" value={formatCurrency(fin.opening_cash || 0)} />
                        <FinRow label="Cash Sales" value={formatCurrency(fin.cash_sales || 0)} color="text-emerald-600" icon={<Banknote className="h-3.5 w-3.5 text-slate-400" />} />
                        {(fin.momo_sales || 0) > 0 && <FinRow label="Mobile Money" value={formatCurrency(fin.momo_sales)} color="text-blue-600" icon={<Smartphone className="h-3.5 w-3.5 text-slate-400" />} />}
                        {(fin.card_sales || 0) > 0 && <FinRow label="Card / Bank" value={formatCurrency(fin.card_sales)} color="text-violet-600" icon={<CreditCard className="h-3.5 w-3.5 text-slate-400" />} />}
                        {(fin.room_charges || 0) > 0 && <FinRow label="Room Charges" value={formatCurrency(fin.room_charges)} color="text-amber-600" icon={<BedDouble className="h-3.5 w-3.5 text-slate-400" />} note="Unpaid" />}

                        {shift.closed_at && (
                          <>
                            <div className="my-1 border-t border-dashed border-slate-200" />
                            <FinRow label="Declared Cash" value={formatCurrency(fin.closing_cash || 0)} />
                            <div className={cn(
                              "flex items-center justify-between rounded-xl px-3.5 py-3 border",
                              variantState.bg
                            )}>
                              <div className={cn("flex items-center gap-2 text-sm font-bold", variantState.color)}>
                                {variantState.icon}
                                Variance · {variantState.label}
                              </div>
                              <span className={cn("font-black text-base tabular-nums", variantState.color)}>
                                {variance > 0 ? '+' : ''}{formatCurrency(variance)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* ── Orders ───────────────────────────────────────── */}
                    {activeTab === 'orders' && orders && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <StatTile value={orders.total_orders || 0} label="Total Orders" color="text-slate-900" />
                          <StatTile value={orders.completed_orders || 0} label="Completed" color="text-emerald-600" />
                          <StatTile value={orders.pending_orders || 0} label="Pending" color="text-amber-600" />
                          <StatTile value={orders.cancelled_orders || 0} label="Cancelled" color="text-red-500" />
                        </div>
                        <div className="space-y-1.5">
                          <FinRow label="Table Orders" value={String(orders.table_orders || 0)} icon={<UtensilsCrossed className="h-3.5 w-3.5 text-slate-400" />} />
                          <FinRow label="Room Service" value={String(orders.room_service_orders || 0)} icon={<BedDouble className="h-3.5 w-3.5 text-slate-400" />} />
                        </div>
                      </div>
                    )}

                    {/* ── Stations ─────────────────────────────────────── */}
                    {activeTab === 'stations' && stations && (
                      <div className="space-y-2">
                        <StationCard
                          icon={<UtensilsCrossed className="h-4 w-4" />}
                          label="Kitchen Production"
                          qty={stations.kitchen?.qty || 0}
                          qtyLabel="items produced"
                          total={formatCurrency(stations.kitchen?.total || 0)}
                          accent="orange"
                        />
                        <StationCard
                          icon={<Wine className="h-4 w-4" />}
                          label="Bar Production"
                          qty={stations.bar?.qty || 0}
                          qtyLabel="drinks served"
                          total={formatCurrency(stations.bar?.total || 0)}
                          accent="violet"
                        />
                        <StationCard
                          icon={<Receipt className="h-4 w-4" />}
                          label="Retail / Stock"
                          qty={stations.inventory?.qty || 0}
                          qtyLabel="units sold"
                          total={formatCurrency(stations.inventory?.total || 0)}
                          accent="emerald"
                        />
                      </div>
                    )}

                    {/* ── Activity ─────────────────────────────────────── */}
                    {activeTab === 'activity' && (
                      <div className="space-y-3">
                        {activity && (
                          <div className="grid grid-cols-2 gap-2">
                            <StatTile value={activity.check_ins || 0} label="Check-ins" color="text-cyan-600" />
                            <StatTile value={activity.check_outs || 0} label="Check-outs" color="text-orange-600" />
                            <StatTile value={activity.service_orders || 0} label="Service Orders" color="text-violet-600" />
                            <StatTile value={activity.payments_processed || 0} label="Payments" color="text-emerald-600" />
                          </div>
                        )}

                        {topItems.length > 0 && (
                          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-3">Top Selling Items</p>
                            <div className="space-y-2">
                              {topItems.map((item: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-slate-700">{item.name}</span>
                                  <span className="text-[10px] font-black text-cyan-700 bg-cyan-50 border border-cyan-100 rounded px-2 py-0.5 tabular-nums">
                                    ×{item.qty}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Notes */}
                    {(shift.opening_notes || shift.closing_notes) && (
                      <div className="space-y-2 pt-1 border-t border-slate-100">
                        {shift.opening_notes && (
                          <NoteBox label="Opening note" text={shift.opening_notes} />
                        )}
                        {shift.closing_notes && (
                          <NoteBox label="Closing note" text={shift.closing_notes} />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            )}
          </div>

          {/* ── RIGHT PANEL: Timeline ───────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Timeline header */}
            <div className="shrink-0 px-6 py-3.5 border-b border-slate-200 bg-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Activity className="h-4 w-4 text-cyan-600" />
                <span className="text-sm font-black text-slate-800 uppercase tracking-wider">Activity Log</span>
                {logs.length > 0 && (
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5 tabular-nums">
                    {logs.length} events
                  </span>
                )}
              </div>
              {shift && (
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Most recent first
                </span>
              )}
            </div>

            <ScrollArea className="flex-1 bg-slate-50">
              <div className="p-5 md:p-8">
                {detailsLoading ? (
                  <div className="space-y-5">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="flex gap-4 items-start">
                        <Skeleton className="h-9 w-9 rounded-full shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3 rounded" />
                          <Skeleton className="h-16 w-full rounded-xl" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                    <Activity className="h-12 w-12 opacity-20 mb-4" />
                    <p className="text-sm font-bold">No events logged yet</p>
                    <p className="text-xs mt-1 text-slate-400">{shift ? "Activity will appear here as the shift progresses" : "Select a shift to view its activity"}</p>
                  </div>
                ) : (
                  <div className="relative">
                    {/* Vertical rail */}
                    <div
                      className="absolute left-[17px] top-4 bottom-4 w-px pointer-events-none"
                      style={{ background: 'linear-gradient(to bottom, #0891B2 0%, #e2e8f0 60%, transparent 100%)' }}
                    />

                    <div className="space-y-4">
                      {logs.map((log: any, index: number) => {
                        const meta = getLogMeta(log.action_type);
                        return (
                          <div key={log.id || index} className="relative flex gap-4 items-start group">
                            {/* Node */}
                            <div className={cn(
                              "relative z-10 h-9 w-9 rounded-full flex items-center justify-center shrink-0 ring-2 ring-slate-50 shadow-sm transition-transform group-hover:scale-110",
                              meta.bg
                            )}>
                              <meta.Icon className={cn("h-4 w-4", meta.color)} />
                            </div>

                            {/* Event card */}
                            <div className="flex-1 min-w-0 rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
                              <div className="flex items-start justify-between gap-3 mb-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={cn(
                                    "text-[10px] font-black uppercase tracking-[0.12em] px-2 py-0.5 rounded-md",
                                    meta.bg, meta.color
                                  )}>
                                    {log.action_type}
                                  </span>
                                  {log.amount && (
                                    <span className="text-xs font-black text-slate-800 bg-slate-100 rounded-md px-2 py-0.5 tabular-nums">
                                      {formatCurrency(log.amount)}
                                    </span>
                                  )}
                                </div>
                                <time className="text-[10px] font-semibold text-slate-400 whitespace-nowrap shrink-0 mt-0.5 tabular-nums">
                                  {formatDistance(new Date(log.created_at), new Date(), { addSuffix: true })}
                                </time>
                              </div>

                              {log.description && (
                                <p className="text-sm text-slate-600 font-medium leading-relaxed">
                                  {log.description}
                                </p>
                              )}

                              {log.reference_id && (
                                <div className="mt-2 flex items-center gap-1.5">
                                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">REF</span>
                                  <code className="text-[10px] font-mono bg-slate-50 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded">
                                    {log.reference_id}
                                  </code>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function TimeChip({ icon, label, value, active = false, small = false }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  active?: boolean;
  small?: boolean;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1">
      <div className="flex items-center gap-1 text-slate-400">
        {icon}
        <span className="text-[9px] font-black uppercase tracking-wider">{label}</span>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse ml-auto" />}
      </div>
      <p className={cn(
        "font-black text-slate-800 tabular-nums leading-none",
        small ? "text-xs" : "text-sm"
      )}>
        {value}
      </p>
    </div>
  );
}

function FinRow({ label, value, color, icon, note }: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors group">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-xs font-medium">{label}</span>
        {note && <span className="text-[9px] font-bold text-amber-600 bg-amber-50 rounded px-1 py-0.5 uppercase">{note}</span>}
      </div>
      <span className={cn("text-sm font-bold tabular-nums", color ?? "text-slate-800")}>
        {value}
      </span>
    </div>
  );
}

function StatTile({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
      <p className={cn("text-2xl font-black tabular-nums leading-none", color)}>{value}</p>
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

function StationCard({ icon, label, qty, qtyLabel, total, accent }: {
  icon: React.ReactNode;
  label: string;
  qty: number;
  qtyLabel: string;
  total: string;
  accent: 'orange' | 'violet' | 'emerald';
}) {
  const palette = {
    orange: 'text-orange-600 bg-orange-50 border-orange-100',
    violet: 'text-violet-600 bg-violet-50 border-violet-100',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 flex items-center justify-between", palette[accent])}>
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <p className="text-xs font-bold">{label}</p>
          <p className="text-[10px] font-medium opacity-70">{qty} {qtyLabel}</p>
        </div>
      </div>
      <span className="font-black text-sm tabular-nums">{total}</span>
    </div>
  );
}

function NoteBox({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">{label}</p>
      <p className="text-xs text-slate-600 font-medium leading-relaxed">{text}</p>
    </div>
  );
}