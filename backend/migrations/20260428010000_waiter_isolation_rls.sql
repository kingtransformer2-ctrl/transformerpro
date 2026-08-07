-- Complete waiter isolation with session-scoped staff context.
-- This migration is defensive: it applies policies only to tables that exist.

CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_staff_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(hs.role::text)
  FROM public.hotel_staff AS hs
  WHERE hs.id = public.current_staff_id()
$$;

CREATE OR REPLACE FUNCTION public.is_manager_or_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_staff_role() IN ('manager', 'owner', 'admin'), false)
$$;

CREATE OR REPLACE FUNCTION public.set_current_staff_id(staff_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_staff_id uuid;
BEGIN
  -- 1. If no staff_id provided, clear the session
  IF staff_id IS NULL THEN
    PERFORM set_config('app.current_staff_id', '', false);
    RETURN true;
  END IF;

  -- 2. Validate that the authenticated user owns this staff record
  -- or has a high-level role (manager/admin/owner)
  SELECT id INTO v_staff_id
  FROM public.hotel_staff
  WHERE id = staff_id
    AND (
      user_id = v_auth_uid 
      OR EXISTS (
        SELECT 1 FROM public.hotel_staff 
        WHERE user_id = v_auth_uid 
        AND role IN ('manager', 'admin', 'owner')
      )
    );

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Privilege escalation attempt detected. You do not have permission to assume this staff identity.'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- 3. Set the session variable
  PERFORM set_config('app.current_staff_id', v_staff_id::text, false);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_current_staff_id()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.current_staff_id', '', false);
  RETURN true;
END;
$$;

-- Revoke anon execute permissions for sensitive session functions
REVOKE EXECUTE ON FUNCTION public.set_current_staff_id(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.clear_current_staff_id() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_current_staff_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_current_staff_id() TO authenticated, service_role;

-- Enforce single active shift per staff member
CREATE OR REPLACE FUNCTION public.shift_belongs_to_current_staff(target_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hotel_staff_shifts AS hs
    WHERE hs.id = target_shift_id
      AND hs.staff_id = public.current_staff_id()
  )
$$;

GRANT EXECUTE ON FUNCTION public.current_staff_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_or_owner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shift_belongs_to_current_staff(uuid) TO authenticated, service_role;

-- Enforce single active shift per staff member
CREATE OR REPLACE FUNCTION public.ensure_single_active_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    IF EXISTS (
      SELECT 1 
      FROM public.hotel_staff_shifts 
      WHERE staff_id = NEW.staff_id 
        AND status = 'active' 
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RAISE EXCEPTION 'Staff member already has an active shift. Close the existing shift first.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.hotel_staff_shifts') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trig_ensure_single_active_shift'
    ) THEN
      CREATE TRIGGER trig_ensure_single_active_shift
      BEFORE INSERT OR UPDATE OF status ON public.hotel_staff_shifts
      FOR EACH ROW EXECUTE FUNCTION public.ensure_single_active_shift();
    END IF;
  END IF;
END $$;

-- --- NEW: Daily Reconciliation Reports ---
DO $$
BEGIN
  IF to_regclass('public.hotel_daily_reports') IS NULL THEN
    CREATE TABLE public.hotel_daily_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      report_date date UNIQUE NOT NULL,
      total_sales numeric(12,2) DEFAULT 0,
      cash_sales numeric(12,2) DEFAULT 0,
      card_sales numeric(12,2) DEFAULT 0,
      momo_sales numeric(12,2) DEFAULT 0,
      bank_sales numeric(12,2) DEFAULT 0,
      room_charges numeric(12,2) DEFAULT 0,
      total_orders integer DEFAULT 0,
      cancelled_orders integer DEFAULT 0,
      net_revenue numeric(12,2) DEFAULT 0,
      summary jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    
    
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.generate_daily_report(target_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  report_id uuid;
BEGIN
  INSERT INTO public.hotel_daily_reports (
    report_date,
    total_sales,
    cash_sales,
    card_sales,
    momo_sales,
    bank_sales,
    room_charges,
    total_orders,
    cancelled_orders,
    net_revenue,
    summary
  )
  SELECT 
    target_date,
    COALESCE(SUM(total_sales), 0),
    COALESCE(SUM((summary->'financial'->>'cash_sales')::numeric), 0),
    COALESCE(SUM((summary->'financial'->>'card_sales')::numeric), 0),
    COALESCE(SUM((summary->'financial'->>'momo_sales')::numeric), 0),
    COALESCE(SUM((summary->'financial'->>'bank_sales')::numeric), 0),
    COALESCE(SUM((summary->'financial'->>'room_charges')::numeric), 0),
    COALESCE(SUM(total_orders), 0),
    COALESCE(SUM((summary->'orders'->>'cancelled_orders')::integer), 0),
    COALESCE(SUM(billed_sales), 0),
    jsonb_build_object(
      'shift_ids', jsonb_agg(id),
      'generated_at', now()
    )
  FROM public.hotel_staff_shifts
  WHERE opened_at::date = target_date
    AND status IN ('closed', 'reviewed', 'CLOSED', 'REVIEWED')
  ON CONFLICT (report_date) DO UPDATE SET
    total_sales = EXCLUDED.total_sales,
    cash_sales = EXCLUDED.cash_sales,
    card_sales = EXCLUDED.card_sales,
    momo_sales = EXCLUDED.momo_sales,
    bank_sales = EXCLUDED.bank_sales,
    room_charges = EXCLUDED.room_charges,
    total_orders = EXCLUDED.total_orders,
    cancelled_orders = EXCLUDED.cancelled_orders,
    net_revenue = EXCLUDED.net_revenue,
    summary = EXCLUDED.summary,
    updated_at = now()
  RETURNING id INTO report_id;

  RETURN report_id;
END;
$$;

-- Function to backfill or refresh reports for a date range
CREATE OR REPLACE FUNCTION public.refresh_daily_reports(start_date date, end_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_d date;
  count integer := 0;
BEGIN
  FOR current_d IN SELECT generate_series(start_date, end_date, '1 day'::interval)::date LOOP
    PERFORM public.generate_daily_report(current_d);
    count := count + 1;
  END LOOP;
  RETURN count;
END;
$$;

-- --- NEW: Service Menu Logic Enhancements ---
DO $$ 
BEGIN
    -- 1. Happy Hour / Special Pricing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_service_menu' AND column_name='special_price') THEN
        ALTER TABLE public.hotel_service_menu ADD COLUMN special_price NUMERIC(12,2);
        ALTER TABLE public.hotel_service_menu ADD COLUMN special_price_start_time TIME;
        ALTER TABLE public.hotel_service_menu ADD COLUMN special_price_end_time TIME;
        ALTER TABLE public.hotel_service_menu ADD COLUMN special_price_days INTEGER[] DEFAULT '{1,2,3,4,5,6,7}'; -- 1=Monday, 7=Sunday
    END IF;

    -- 2. Stock Alerts & Auto-Availability
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_service_menu' AND column_name='last_stock_alert_at') THEN
        ALTER TABLE public.hotel_service_menu ADD COLUMN last_stock_alert_at TIMESTAMPTZ;
        ALTER TABLE public.hotel_service_menu ADD COLUMN auto_disable_on_out_of_stock BOOLEAN DEFAULT TRUE;
    END IF;

    -- 3. Station Assignment
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_service_menu' AND column_name='station') THEN
        ALTER TABLE public.hotel_service_menu ADD COLUMN station VARCHAR(20) DEFAULT 'kitchen'; -- 'kitchen', 'bar', 'other'
    END IF;

    -- 4. KDS Timers
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='preparing_started_at') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN preparing_started_at TIMESTAMPTZ;
        ALTER TABLE public.hotel_orders ADD COLUMN ready_at TIMESTAMPTZ;
    END IF;

    -- 5. Advanced Ingredient Tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_ingredients' AND column_name='current_unit_volume') THEN
        ALTER TABLE public.hotel_ingredients ADD COLUMN current_unit_volume NUMERIC(12,2) DEFAULT 0;
        ALTER TABLE public.hotel_ingredients ADD COLUMN auto_open_new_unit BOOLEAN DEFAULT TRUE;
    END IF;
END $$;

-- Trigger to auto-disable items when stock hits zero
CREATE OR REPLACE FUNCTION public.check_service_item_stock()
RETURNS TRIGGER AS $$
DECLARE
    recipe_row RECORD;
    ingredient_row RECORD;
    can_fulfill BOOLEAN;
BEGIN
    -- 1. Direct Stock Check
    IF NEW.track_stock = TRUE AND NEW.stock_quantity <= 0 AND NEW.auto_disable_on_out_of_stock = TRUE THEN
        NEW.is_available = FALSE;
    END IF;
    
    IF NEW.track_stock = TRUE AND NEW.stock_quantity > 0 AND OLD.stock_quantity <= 0 AND NEW.auto_disable_on_out_of_stock = TRUE THEN
        NEW.is_available = TRUE;
    END IF;

    -- 2. Ingredient Availability Check
    -- If an item is being marked as available, check if its ingredients are actually available
    IF NEW.is_available = TRUE THEN
        can_fulfill := TRUE;
        FOR recipe_row IN SELECT * FROM public.hotel_service_item_recipes WHERE service_item_id = NEW.id LOOP
            IF recipe_row.ingredient_id IS NOT NULL THEN
                SELECT stock_quantity, current_unit_volume INTO ingredient_row 
                FROM public.hotel_ingredients WHERE id = recipe_row.ingredient_id;
                
                -- If no stock and no open unit volume, we can't make it
                IF ingredient_row.stock_quantity <= 0 AND ingredient_row.current_unit_volume < recipe_row.quantity_required THEN
                    can_fulfill := FALSE;
                    EXIT;
                END IF;
            END IF;
        END LOOP;
        
        IF NOT can_fulfill THEN
            NEW.is_available = FALSE;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on hotel_ingredients to update service menu availability
CREATE OR REPLACE FUNCTION public.sync_menu_to_ingredient_stock()
RETURNS TRIGGER AS $$
BEGIN
    -- If ingredient stock is now zero/low, we need to check all recipes using it
    IF NEW.stock_quantity <= 0 AND NEW.current_unit_volume <= 0 THEN
        UPDATE public.hotel_service_menu m
        SET is_available = FALSE
        WHERE id IN (
            SELECT service_item_id 
            FROM public.hotel_service_item_recipes 
            WHERE ingredient_id = NEW.id
        ) AND m.auto_disable_on_out_of_stock = TRUE;
    END IF;

    -- If stock was added, we might be able to re-enable items
    IF (NEW.stock_quantity > 0 OR NEW.current_unit_volume > 0) AND (OLD.stock_quantity <= 0 AND OLD.current_unit_volume <= 0) THEN
        -- We don't auto-enable (safety first), but the system will check next time the item is saved/refreshed
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trig_sync_menu_to_ingredient_stock') THEN
        CREATE TRIGGER trig_sync_menu_to_ingredient_stock
        AFTER UPDATE OF stock_quantity, current_unit_volume ON public.hotel_ingredients
        FOR EACH ROW EXECUTE FUNCTION public.sync_menu_to_ingredient_stock();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trig_check_service_item_stock') THEN
        CREATE TRIGGER trig_check_service_item_stock
        BEFORE UPDATE OF stock_quantity ON public.hotel_service_menu
        FOR EACH ROW EXECUTE FUNCTION public.check_service_item_stock();
    END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.hotel_orders') IS NOT NULL THEN
    ALTER TABLE public.hotel_orders DROP CONSTRAINT IF EXISTS valid_order_status;
    ALTER TABLE public.hotel_orders ADD CONSTRAINT valid_order_status
      CHECK (status IN (
        'pending',
        'preparing',
        'ready',
        'served',
        'cancelled',
        'billed',
        'paid',
        'settled',
        'awaiting_approval',
        'pending_handover',
        'confirmed'
      ));

    

    DROP POLICY IF EXISTS "waiter isolation hotel_orders select" ON public.hotel_orders;
    DROP POLICY IF EXISTS "waiter isolation hotel_orders insert" ON public.hotel_orders;
    DROP POLICY IF EXISTS "waiter isolation hotel_orders update" ON public.hotel_orders;

    
    
    
  END IF;
END
$$;

DO $$
DECLARE
  owner_expr text;
BEGIN
  IF to_regclass('public.hotel_transactions') IS NOT NULL THEN
    

    DROP POLICY IF EXISTS "waiter isolation hotel_transactions select" ON public.hotel_transactions;
    DROP POLICY IF EXISTS "waiter isolation hotel_transactions insert" ON public.hotel_transactions;
    DROP POLICY IF EXISTS "waiter isolation hotel_transactions update" ON public.hotel_transactions;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hotel_transactions'
        AND column_name = 'created_by'
    ) THEN
      owner_expr := 'created_by = public.current_staff_id()';
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hotel_transactions'
        AND column_name = 'staff_id'
    ) THEN
      owner_expr := 'staff_id = public.current_staff_id()';
    ELSE
      owner_expr := 'false';
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_transactions FOR SELECT USING (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_transactions select', owner_expr
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_transactions FOR INSERT WITH CHECK (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_transactions insert', owner_expr
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_transactions FOR UPDATE USING (%s OR public.is_manager_or_owner()) WITH CHECK (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_transactions update', owner_expr, owner_expr
    );
  END IF;
END
$$;

DO $$
DECLARE
  owner_expr text;
BEGIN
  IF to_regclass('public.hotel_kot') IS NOT NULL THEN
    

    DROP POLICY IF EXISTS "waiter isolation hotel_kot select" ON public.hotel_kot;
    DROP POLICY IF EXISTS "waiter isolation hotel_kot insert" ON public.hotel_kot;
    DROP POLICY IF EXISTS "waiter isolation hotel_kot update" ON public.hotel_kot;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hotel_kot'
        AND column_name = 'created_by'
    ) THEN
      owner_expr := 'created_by = public.current_staff_id()';
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hotel_kot'
        AND column_name = 'staff_id'
    ) THEN
      owner_expr := 'staff_id = public.current_staff_id()';
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hotel_kot'
        AND column_name = 'waiter_id'
    ) THEN
      owner_expr := 'waiter_id = public.current_staff_id()';
    ELSE
      owner_expr := 'false';
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_kot FOR SELECT USING (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_kot select', owner_expr
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_kot FOR INSERT WITH CHECK (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_kot insert', owner_expr
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_kot FOR UPDATE USING (%s OR public.is_manager_or_owner()) WITH CHECK (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_kot update', owner_expr, owner_expr
    );
  END IF;
END
$$;

DO $$
DECLARE
  owner_expr text;
BEGIN
  IF to_regclass('public.hotel_handovers') IS NOT NULL THEN
    

    DROP POLICY IF EXISTS "waiter isolation hotel_handovers select" ON public.hotel_handovers;
    DROP POLICY IF EXISTS "waiter isolation hotel_handovers insert" ON public.hotel_handovers;
    DROP POLICY IF EXISTS "waiter isolation hotel_handovers update" ON public.hotel_handovers;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hotel_handovers'
        AND column_name = 'created_by'
    ) THEN
      owner_expr := 'created_by = public.current_staff_id()';
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hotel_handovers'
        AND column_name = 'staff_id'
    ) THEN
      owner_expr := 'staff_id = public.current_staff_id()';
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hotel_handovers'
        AND column_name = 'waiter_id'
    ) THEN
      owner_expr := 'waiter_id = public.current_staff_id()';
    ELSE
      owner_expr := 'false';
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_handovers FOR SELECT USING (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_handovers select', owner_expr
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_handovers FOR INSERT WITH CHECK (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_handovers insert', owner_expr
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.hotel_handovers FOR UPDATE USING (%s OR public.is_manager_or_owner()) WITH CHECK (%s OR public.is_manager_or_owner())',
      'waiter isolation hotel_handovers update', owner_expr, owner_expr
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.hotel_staff_shifts') IS NOT NULL THEN
    

    DROP POLICY IF EXISTS "waiter isolation hotel_staff_shifts select" ON public.hotel_staff_shifts;
    DROP POLICY IF EXISTS "waiter isolation hotel_staff_shifts insert" ON public.hotel_staff_shifts;
    DROP POLICY IF EXISTS "waiter isolation hotel_staff_shifts update" ON public.hotel_staff_shifts;

    
    
    
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.hotel_shift_logs') IS NOT NULL THEN
    

    DROP POLICY IF EXISTS "waiter isolation hotel_shift_logs select" ON public.hotel_shift_logs;
    DROP POLICY IF EXISTS "waiter isolation hotel_shift_logs insert" ON public.hotel_shift_logs;
    DROP POLICY IF EXISTS "waiter isolation hotel_shift_logs update" ON public.hotel_shift_logs;

    
    
    
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.hotel_shift_transactions') IS NOT NULL THEN
    

    DROP POLICY IF EXISTS "waiter isolation hotel_shift_transactions select" ON public.hotel_shift_transactions;
    DROP POLICY IF EXISTS "waiter isolation hotel_shift_transactions insert" ON public.hotel_shift_transactions;
    DROP POLICY IF EXISTS "waiter isolation hotel_shift_transactions update" ON public.hotel_shift_transactions;

    
    
    
  END IF;
END
$$;

-- Verification query to run after deployment:
-- SELECT schemaname, tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'hotel_orders',
--     'hotel_transactions',
--     'hotel_kot',
--     'hotel_handovers',
--     'hotel_staff_shifts',
--     'hotel_shift_logs'
--   )
-- ORDER BY tablename, cmd, policyname;