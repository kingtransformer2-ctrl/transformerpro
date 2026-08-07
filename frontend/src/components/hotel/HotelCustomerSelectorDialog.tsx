import { useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCustomers, type Customer } from "@/hooks/useCustomers";
import { Loader2, Plus, Search, UserRound, X, Check, Users, Phone, Mail, MapPin, Hash } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface HotelCustomerSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCustomer: Customer | null;
  onSelectCustomer: (customer: Customer | null) => void;
}

const EMPTY_FORM = { name: "", phone: "", email: "", address: "", tin_number: "" };

// ── Deterministic avatar color from name ───────────────────────────
const AVATAR_PALETTES = [
  { bg: "bg-violet-100", text: "text-violet-700", ring: "ring-violet-200" },
  { bg: "bg-cyan-100",   text: "text-cyan-700",   ring: "ring-cyan-200"   },
  { bg: "bg-rose-100",   text: "text-rose-700",   ring: "ring-rose-200"   },
  { bg: "bg-amber-100",  text: "text-amber-700",  ring: "ring-amber-200"  },
  { bg: "bg-emerald-100",text: "text-emerald-700",ring: "ring-emerald-200"},
  { bg: "bg-indigo-100", text: "text-indigo-700", ring: "ring-indigo-200" },
  { bg: "bg-orange-100", text: "text-orange-700", ring: "ring-orange-200" },
];

function getAvatarPalette(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

// ── Avatar ─────────────────────────────────────────────────────────
function CustomerAvatar({ name, selected }: { name: string; selected?: boolean }) {
  const palette = getAvatarPalette(name);
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <div className={cn(
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black transition-all ring-2 ring-offset-1",
      selected
        ? "bg-slate-900 text-white ring-slate-900/20"
        : `${palette.bg} ${palette.text} ${palette.ring}`
    )}>
      {selected ? <Check className="h-4 w-4" /> : initial}
    </div>
  );
}

// ── Form field ─────────────────────────────────────────────────────
function FormField({
  id, label, required, icon, ...inputProps
}: {
  id: string;
  label: string;
  required?: boolean;
  icon?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"
      >
        {label}{required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            {icon}
          </span>
        )}
        <input
          id={id}
          className={cn(
            "h-10 w-full rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800",
            "placeholder:text-slate-400 transition-all outline-none",
            "focus:border-slate-400 focus:ring-2 focus:ring-slate-100",
            icon ? "pl-9 pr-3" : "px-3"
          )}
          {...inputProps}
        />
      </div>
    </div>
  );
}

export function HotelCustomerSelectorDialog({
  open,
  onOpenChange,
  selectedCustomer,
  onSelectCustomer,
}: HotelCustomerSelectorDialogProps) {
  const { customers, loading, addCustomer } = useCustomers();
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const filteredCustomers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter(c =>
      [c.name, c.phone || "", c.email || "", c.address || ""].join(" ").toLowerCase().includes(query)
    );
  }, [customers, searchTerm]);

  const handleCreateCustomer = async () => {
    if (!formData.name.trim()) { toast.error("Customer name is required"); return; }
    setIsCreating(true);
    try {
      const newCustomer = await addCustomer({
        name: formData.name.trim(),
        phone: formData.phone.trim() || undefined,
        email: formData.email.trim() || undefined,
        address: formData.address.trim() || undefined,
        tin_number: formData.tin_number.trim() || undefined,
      });
      onSelectCustomer(newCustomer);
      setFormData(EMPTY_FORM);
      setSearchTerm("");
      onOpenChange(false);
      toast.success("Customer created and selected");
    } catch (error: any) {
      toast.error(error?.message || "Failed to create customer");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "z-[81]",
          "flex max-h-[92dvh] w-screen max-w-none flex-col overflow-hidden",
          "border-0 p-0 bg-white",
          "sm:max-h-[88dvh] sm:max-w-[860px] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-2xl sm:shadow-slate-900/15"
        )}
        overlayClassName="z-[80] bg-black/80"
        aria-describedby={undefined}
      >

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="shrink-0 bg-slate-900 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <UserRound className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-black text-white tracking-tight">Select Customer</h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Search existing records or create a new one</p>
              </div>
            </div>
            {/* Selected customer pill */}
            {selectedCustomer && (
              <div className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 px-3 py-1">
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-[11px] font-bold text-emerald-300 max-w-[120px] truncate">{selectedCustomer.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[1fr_300px]">

          {/* ── Left: search + list ──────────────────────────────── */}
          <div className="flex min-h-0 flex-col border-r border-slate-100">

            {/* Search bar */}
            <div className="shrink-0 border-b border-slate-100 px-4 py-3 sm:px-5 bg-slate-50/70">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search by name, phone, email…"
                  className={cn(
                    "h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-medium text-slate-800",
                    "placeholder:text-slate-400 outline-none transition-all",
                    "focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                  )}
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Users className="h-3 w-3 text-slate-400" />
                <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                  {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {/* Customer list */}
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 px-4 py-3 sm:px-5">

                {/* Walk-in row */}
                <button
                  type="button"
                  onClick={() => { onSelectCustomer(null); onOpenChange(false); }}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-200",
                    "bg-white px-4 py-3 text-left transition-all",
                    "hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 group-hover:bg-slate-200 transition-colors">
                    <X className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700">Walk-in · No customer</p>
                    <p className="text-[11px] text-slate-400 font-medium">Continue without a saved record</p>
                  </div>
                  <span className="ml-auto shrink-0 text-[10px] font-bold text-slate-300 uppercase tracking-wider group-hover:text-slate-500 transition-colors">
                    Skip →
                  </span>
                </button>

                {/* Divider */}
                <div className="py-1">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-100" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-2 text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">
                        Saved Customers
                      </span>
                    </div>
                  </div>
                </div>

                {/* Loading */}
                {loading ? (
                  <div className="flex items-center justify-center py-14">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </div>

                /* Empty */
                ) : filteredCustomers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center">
                    <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-500">No customers match your search</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Try a different name or create a new one →</p>
                  </div>

                /* Customer rows */
                ) : filteredCustomers.map(customer => {
                  const isSelected = selectedCustomer?.id === customer.id;
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => { onSelectCustomer(customer); onOpenChange(false); }}
                      className={cn(
                        "group flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                        isSelected
                          ? "border-slate-900 bg-slate-900 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                      )}
                    >
                      <CustomerAvatar name={customer.name} selected={isSelected} />

                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          "truncate text-sm font-bold leading-none",
                          isSelected ? "text-white" : "text-slate-800"
                        )}>
                          {customer.name}
                        </p>
                        <div className={cn(
                          "mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]",
                          isSelected ? "text-slate-400" : "text-slate-500"
                        )}>
                          {customer.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-2.5 w-2.5 shrink-0" />
                              {customer.phone}
                            </span>
                          )}
                          {customer.tin_number && (
                            <span className="flex items-center gap-1">
                              <Hash className="h-2.5 w-2.5 shrink-0" />
                              {customer.tin_number}
                            </span>
                          )}
                          {customer.email && (
                            <span className="flex items-center gap-1 truncate max-w-[180px]">
                              <Mail className="h-2.5 w-2.5 shrink-0" />
                              {customer.email}
                            </span>
                          )}
                          {customer.address && (
                            <span className="flex items-center gap-1 truncate max-w-[160px]">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {customer.address}
                            </span>
                          )}
                        </div>
                      </div>

                      {isSelected ? (
                        <span className="shrink-0 self-center text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                          Selected
                        </span>
                      ) : (
                        <span className="shrink-0 self-center text-[10px] font-bold text-slate-300 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                          Select →
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* ── Right: quick-create form ──────────────────────────── */}
          <div className="flex min-h-0 flex-col bg-slate-50 border-l border-slate-100 overflow-hidden">

            {/* Panel header */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-lg bg-slate-900 flex items-center justify-center">
                  <Plus className="h-3.5 w-3.5 text-white" />
                </div>
                <h3 className="text-sm font-black text-slate-800 tracking-tight">New Customer</h3>
              </div>
              <p className="mt-1 text-[11px] text-slate-400 font-medium leading-relaxed">
                Fill in details to create and attach immediately.
              </p>
            </div>

            {/* Form */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-5 py-4 space-y-3.5">
                <FormField
                  id="hotel-customer-name"
                  label="Full name"
                  required
                  icon={<UserRound className="h-3.5 w-3.5" />}
                  value={formData.name}
                  onChange={e => setFormData(c => ({ ...c, name: e.target.value }))}
                  placeholder="e.g. Jane Doe"
                />
                <FormField
                  id="hotel-customer-phone"
                  label="Phone"
                  icon={<Phone className="h-3.5 w-3.5" />}
                  value={formData.phone}
                  onChange={e => setFormData(c => ({ ...c, phone: e.target.value }))}
                  placeholder="+250 7XX XXX XXX"
                />
                <FormField
                  id="hotel-customer-tin"
                  label="TIN number"
                  icon={<Hash className="h-3.5 w-3.5" />}
                  value={formData.tin_number}
                  onChange={e => setFormData(c => ({ ...c, tin_number: e.target.value }))}
                  placeholder="Tax ID (optional)"
                />
                <FormField
                  id="hotel-customer-email"
                  label="Email"
                  type="email"
                  icon={<Mail className="h-3.5 w-3.5" />}
                  value={formData.email}
                  onChange={e => setFormData(c => ({ ...c, email: e.target.value }))}
                  placeholder="email@example.com"
                />
                <FormField
                  id="hotel-customer-address"
                  label="Address"
                  icon={<MapPin className="h-3.5 w-3.5" />}
                  value={formData.address}
                  onChange={e => setFormData(c => ({ ...c, address: e.target.value }))}
                  placeholder="Street, city, country"
                />
              </div>
            </ScrollArea>

            {/* Submit */}
            <div className="shrink-0 px-5 py-4 border-t border-slate-200 bg-white space-y-2">
              <button
                onClick={handleCreateCustomer}
                disabled={isCreating || !formData.name.trim()}
                className={cn(
                  "w-full h-10 rounded-xl text-xs font-black uppercase tracking-[0.12em] transition-all flex items-center justify-center gap-2",
                  "bg-slate-900 text-white hover:bg-slate-700 shadow-sm",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none",
                  "active:scale-[0.98]"
                )}
              >
                {isCreating
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>
                  : <><Plus className="h-3.5 w-3.5" /> Create & Select</>
                }
              </button>
              <p className="text-center text-[10px] text-slate-400 font-medium">
                Saved instantly to your customer database
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
