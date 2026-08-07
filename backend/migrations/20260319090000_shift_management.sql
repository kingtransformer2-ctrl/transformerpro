CREATE TABLE IF NOT EXISTS public.hotel_staff_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
  staff_role public.staff_role NOT NULL DEFAULT 'receptionist',
  shift_label TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'PENDING',
  opening_cash NUMERIC DEFAULT 0,
  closing_cash NUMERIC,
  expected_cash NUMERIC,
  difference NUMERIC,
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  opening_notes TEXT,
  closing_notes TEXT,
  pending_orders JSONB,
  summary JSONB,
  total_sales NUMERIC,
  billed_sales NUMERIC,
  total_orders INTEGER,
  total_items INTEGER,
  closing_report TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.hotel_staff_shifts
  ADD COLUMN IF NOT EXISTS opening_cash NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_cash NUMERIC,
  ADD COLUMN IF NOT EXISTS expected_cash NUMERIC,
  ADD COLUMN IF NOT EXISTS difference NUMERIC,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opening_notes TEXT,
  ADD COLUMN IF NOT EXISTS closing_notes TEXT,
  ADD COLUMN IF NOT EXISTS pending_orders JSONB,
  ADD COLUMN IF NOT EXISTS summary JSONB,
  ADD COLUMN IF NOT EXISTS total_sales NUMERIC,
  ADD COLUMN IF NOT EXISTS billed_sales NUMERIC,
  ADD COLUMN IF NOT EXISTS total_orders INTEGER,
  ADD COLUMN IF NOT EXISTS total_items INTEGER,
  ADD COLUMN IF NOT EXISTS closing_report TEXT,
  ADD COLUMN IF NOT EXISTS shift_label TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS staff_role public.staff_role DEFAULT 'receptionist',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hotel_staff_shifts_status_check'
  ) THEN
    ALTER TABLE public.hotel_staff_shifts
      ADD CONSTRAINT hotel_staff_shifts_status_check
      CHECK (status IN ('PENDING', 'ACTIVE', 'CLOSED', 'REVIEWED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotel_staff_shifts_staff ON public.hotel_staff_shifts(staff_id);
CREATE INDEX IF NOT EXISTS idx_hotel_staff_shifts_status ON public.hotel_staff_shifts(status);

CREATE TABLE IF NOT EXISTS public.hotel_shift_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  description TEXT,
  amount NUMERIC,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hotel_shift_logs_shift ON public.hotel_shift_logs(shift_id);
CREATE INDEX IF NOT EXISTS idx_hotel_shift_logs_action ON public.hotel_shift_logs(action_type);

CREATE TABLE IF NOT EXISTS public.hotel_shift_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hotel_shift_transactions_type_check'
  ) THEN
    ALTER TABLE public.hotel_shift_transactions
      ADD CONSTRAINT hotel_shift_transactions_type_check
      CHECK (type IN ('cash', 'momo', 'card', 'upi', 'bank_transfer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotel_shift_transactions_shift ON public.hotel_shift_transactions(shift_id);

ALTER TABLE public.hotel_orders
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hotel_orders_shift ON public.hotel_orders(shift_id);

ALTER TABLE public.hotel_invoices
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hotel_invoices_shift ON public.hotel_invoices(shift_id);

ALTER TABLE public.hotel_stock_movements
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL;

ALTER TABLE public.hotel_bookings
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;

ALTER TABLE public.hotel_invoice_items
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL;

ALTER TABLE public.hotel_order_items
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL;






DROP POLICY IF EXISTS "Authenticated users can manage shifts" ON public.hotel_staff_shifts;

DROP POLICY IF EXISTS "Authenticated users can manage shift logs" ON public.hotel_shift_logs;

DROP POLICY IF EXISTS "Authenticated users can manage shift transactions" ON public.hotel_shift_transactions;

-- Anti-fraud: Prevent deleting orders and invoices
DROP POLICY IF EXISTS "Authenticated users can manage hotel orders" ON public.hotel_orders;
DROP POLICY IF EXISTS "Users can view orders" ON public.hotel_orders;
DROP POLICY IF EXISTS "Users can insert orders" ON public.hotel_orders;
DROP POLICY IF EXISTS "Users can update orders" ON public.hotel_orders;



DROP POLICY IF EXISTS "Authenticated users can manage hotel invoices" ON public.hotel_invoices;
DROP POLICY IF EXISTS "Users can view invoices" ON public.hotel_invoices;
DROP POLICY IF EXISTS "Users can insert invoices" ON public.hotel_invoices;


DROP POLICY IF EXISTS "Authenticated users can manage hotel invoice items" ON public.hotel_invoice_items;
DROP POLICY IF EXISTS "Users can view invoice items" ON public.hotel_invoice_items;
DROP POLICY IF EXISTS "Users can insert invoice items" ON public.hotel_invoice_items;

