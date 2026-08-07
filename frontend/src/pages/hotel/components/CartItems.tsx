import { HotelCartItem } from "@/hooks/useHotelPOS";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Minus, Plus, Trash2, MessageSquare, Tag } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

interface CartItemsProps {
  cart: HotelCartItem[];
  updateQuantity: (id: string, q: number) => void;
  removeFromCart: (id: string) => void;
  itemNotes: Record<string, string>;
  setItemNotes: (notes: Record<string, string>) => void;
  orderNotes: string;
  setOrderNotes: (notes: string) => void;
  formatCurrency: (v: number) => string;
}

export const CartItems = memo(({
  cart,
  updateQuantity,
  removeFromCart,
  itemNotes,
  setItemNotes,
  orderNotes,
  setOrderNotes,
  formatCurrency,
}: CartItemsProps) => {
  // Local draft state for quantity inputs — the user types here freely
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});

  // Track which item IDs are currently focused so the sync effect
  // does NOT overwrite a value the user is actively typing
  const editingRef = useRef<Set<string>>(new Set());

  // Keep drafts in sync with cart — but only for items NOT being edited
  useEffect(() => {
    setQuantityDrafts((prev) => {
      const next: Record<string, string> = {};
      cart.forEach((item) => {
        if (editingRef.current.has(item.id)) {
          // User is typing — preserve their draft
          next[item.id] = prev[item.id] ?? String(item.quantity);
        } else {
          // Not focused — always mirror the real cart value
          next[item.id] = String(item.quantity);
        }
      });
      return next;
    });
  }, [cart]);

  // Called on blur / Enter — validate and commit to cart
  const commitQuantity = (cartItemId: string, fallbackQuantity: number) => {
    const draft = quantityDrafts[cartItemId];

    if (draft === undefined) return;

    const trimmed = draft.trim();

    // Empty input → reset to current value without calling updateQuantity
    if (!trimmed) {
      setQuantityDrafts((prev) => ({ ...prev, [cartItemId]: String(fallbackQuantity) }));
      return;
    }

    const parsed = Number.parseInt(trimmed, 10);

    // Non-numeric → reset
    if (!Number.isFinite(parsed) || parsed < 0) {
      setQuantityDrafts((prev) => ({ ...prev, [cartItemId]: String(fallbackQuantity) }));
      return;
    }

    // 0 → remove from cart
    if (parsed === 0) {
      removeFromCart(cartItemId);
      return;
    }

    updateQuantity(cartItemId, parsed);
  };

  // Only update the local draft — never call updateQuantity while typing
  const handleQuantityChange = (item: HotelCartItem, rawValue: string) => {
    // Allow only digits
    const nextValue = rawValue.replace(/[^\d]/g, "");
    setQuantityDrafts((prev) => ({ ...prev, [item.id]: nextValue }));
    // updateQuantity is intentionally NOT called here.
    // Committing happens in onBlur / Enter via commitQuantity.
  };

  return (
    <div className="flex flex-col">
      {cart.length > 0 && (
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_96px_92px_28px] items-center border-b border-slate-200 bg-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <span>Item</span>
          <span className="text-center">Qty</span>
          <span className="text-right">Price</span>
          <span />
        </div>
      )}

      <div className="divide-y divide-slate-200 border-b border-slate-200">
        {cart.map((item) => (
          <div
            key={item.id}
            className="group border-l-2 border-l-primary/70 bg-primary/[0.03] px-3 py-2.5 transition-colors hover:bg-slate-50"
          >
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_96px_92px_28px] md:items-center">
              {/* ── Item name + seat selector ── */}
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2 md:block">
                  <div className="min-w-0">
                    <h4 className="truncate text-[13px] font-medium text-slate-900">
                      {item.service.name}
                    </h4>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {formatCurrency(item.unit_price)} each
                    </p>
                  </div>
                  {/* Mobile delete */}
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors md:hidden"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {itemNotes[item.id] && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <MessageSquare className="h-3 w-3 text-slate-400" />
                    <p className="truncate">{itemNotes[item.id]}</p>
                  </div>
                )}
              </div>

              {/* ── Quantity stepper ── */}
              <div className="flex items-center justify-start md:justify-center">
                <div className="grid h-8 grid-cols-[28px_38px_28px] items-center rounded-full border-2 border-slate-500 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  {/* Decrement */}
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    className="flex h-8 w-7 items-center justify-center rounded-l-full text-slate-600 transition-colors hover:bg-slate-100"
                  >
                    <Minus className="h-3.5 w-3.5 stroke-[2.5]" />
                  </button>

                  {/* Quantity input — free-type, commits on blur/Enter */}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    value={quantityDrafts[item.id] ?? String(item.quantity)}
                    onChange={(e) => handleQuantityChange(item, e.target.value)}
                    onFocus={(e) => {
                      editingRef.current.add(item.id); // prevent sync override
                      e.currentTarget.select();
                    }}
                    onBlur={() => {
                      editingRef.current.delete(item.id); // allow sync again
                      commitQuantity(item.id, item.quantity);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur(); // triggers onBlur → commitQuantity
                      }
                      if (e.key === "Escape") {
                        // Cancel edit — restore last committed value
                        setQuantityDrafts((prev) => ({
                          ...prev,
                          [item.id]: String(item.quantity),
                        }));
                        editingRef.current.delete(item.id);
                        e.currentTarget.blur();
                      }
                      // Allow arrow keys to increment/decrement
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        updateQuantity(item.id, item.quantity + 1);
                      }
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        updateQuantity(item.id, Math.max(1, item.quantity - 1));
                      }
                    }}
                    className="h-8 w-9 border-x border-slate-300 bg-slate-50 px-0 text-center text-[12px] font-black tabular-nums text-slate-900 focus:bg-white focus:outline-none focus:ring-0"
                    aria-label={`Quantity for ${item.service.name}`}
                  />

                  {/* Increment */}
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    className="flex h-8 w-7 items-center justify-center rounded-r-full text-slate-600 transition-colors hover:bg-slate-100"
                  >
                    <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                  </button>
                </div>
              </div>

              {/* ── Line total + desktop delete ── */}
              <div className="flex items-center justify-between md:justify-end gap-3">
                <div className="text-right">
                  <p className="text-[13px] font-semibold tabular-nums text-slate-900">
                    {formatCurrency(item.unit_price * item.quantity)}
                  </p>
                </div>
                {/* Desktop delete */}
                <button
                  onClick={() => removeFromCart(item.id)}
                  className="hidden md:flex h-7 w-7 items-center justify-center rounded-sm text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* ── Per-item note ── */}
            <div className="mt-2">
              <div className="relative rounded-sm border border-slate-200 bg-white">
                <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
                  <MessageSquare className="h-3 w-3 text-slate-300" />
                </div>
                <input
                  placeholder="Add note"
                  value={itemNotes[item.id] || ""}
                  onChange={(e) =>
                    setItemNotes({ ...itemNotes, [item.id]: e.target.value })
                  }
                  className="h-8 w-full rounded-sm bg-transparent pl-8 pr-3 text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Order-level notes ── */}
      {cart.length > 0 && (
        <div className="mt-4 px-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="rounded-sm border border-slate-200 bg-slate-100 p-1.5">
              <Tag className="h-3.5 w-3.5 text-slate-600" />
            </div>
            <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Order Notes
            </Label>
          </div>
          <Textarea
            placeholder="Add a note for the whole order"
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            className="min-h-[72px] resize-none rounded-sm border-slate-200 bg-white p-2.5 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-primary/30 focus:ring-0"
          />
        </div>
      )}
    </div>
  );
});

CartItems.displayName = "CartItems";