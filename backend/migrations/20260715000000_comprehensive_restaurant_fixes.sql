-- ==========================================================
-- Comprehensive Restaurant Management Fixes
-- Date: 2026-07-15
-- Description: Fixes all identified issues in the restaurant
-- management system including table status validation, 
-- order management, waiter assignments, and billing.
-- ==========================================================

BEGIN;

-- ==========================================================
-- 1. FIX: Ensure hotel_tables status never gets empty string
-- Add a CHECK constraint that prevents invalid status values
-- ==========================================================
ALTER TABLE hotel_tables DROP CONSTRAINT IF EXISTS hotel_tables_status_check;
ALTER TABLE hotel_tables ADD CONSTRAINT hotel_tables_status_check 
  CHECK (status IN ('free', 'reserved', 'occupied', 'cleaning'));

-- ==========================================================
-- 2. FIX: Add default status handling via trigger
-- ==========================================================
CREATE OR REPLACE FUNCTION validate_hotel_table_status()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS NULL OR NEW.status = '' OR NEW.status NOT IN ('free', 'reserved', 'occupied', 'cleaning') THEN
    NEW.status := 'free';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_hotel_table_status ON hotel_tables;
CREATE TRIGGER trg_validate_hotel_table_status
  BEFORE INSERT OR UPDATE ON hotel_tables
  FOR EACH ROW
  EXECUTE FUNCTION validate_hotel_table_status();

-- ==========================================================
-- 3. FIX: Add customer fields to hotel_orders if missing
-- ==========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_orders' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE hotel_orders ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_orders' AND column_name = 'customer_name'
  ) THEN
    ALTER TABLE hotel_orders ADD COLUMN customer_name TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_orders' AND column_name = 'customer_phone'
  ) THEN
    ALTER TABLE hotel_orders ADD COLUMN customer_phone TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_orders' AND column_name = 'customer_email'
  ) THEN
    ALTER TABLE hotel_orders ADD COLUMN customer_email TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_orders' AND column_name = 'customer_address'
  ) THEN
    ALTER TABLE hotel_orders ADD COLUMN customer_address TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_orders' AND column_name = 'customer_tin'
  ) THEN
    ALTER TABLE hotel_orders ADD COLUMN customer_tin TEXT;
  END IF;
END $$;

-- ==========================================================
-- 4. FIX: Add preparing_started_at and ready_at columns if missing
-- ==========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_orders' AND column_name = 'preparing_started_at'
  ) THEN
    ALTER TABLE hotel_orders ADD COLUMN preparing_started_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_orders' AND column_name = 'ready_at'
  ) THEN
    ALTER TABLE hotel_orders ADD COLUMN ready_at TIMESTAMPTZ;
  END IF;
END $$;

-- ==========================================================
-- 5. FIX: Add hotel_staff_payments table if not exists
-- ==========================================================
CREATE TABLE IF NOT EXISTS hotel_staff_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES hotel_staff(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES hotel_staff_shifts(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_type TEXT NOT NULL DEFAULT 'salary',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 6. FIX: Add missing columns to hotel_expenses for better tracking
-- ==========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_expenses' AND column_name = 'shift_id'
  ) THEN
    ALTER TABLE hotel_expenses ADD COLUMN shift_id UUID REFERENCES hotel_staff_shifts(id) ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_expenses' AND column_name = 'staff_id'
  ) THEN
    ALTER TABLE hotel_expenses ADD COLUMN staff_id UUID REFERENCES hotel_staff(id) ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_expenses' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE hotel_expenses ADD COLUMN payment_method TEXT DEFAULT 'cash';
  END IF;
END $$;

-- ==========================================================
-- 7. FIX: Add hotel_damages table improvements
-- ==========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_damages' AND column_name = 'shift_id'
  ) THEN
    ALTER TABLE hotel_damages ADD COLUMN shift_id UUID REFERENCES hotel_staff_shifts(id) ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hotel_damages' AND column_name = 'staff_id'
  ) THEN
    ALTER TABLE hotel_damages ADD COLUMN staff_id UUID REFERENCES hotel_staff(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ==========================================================
-- 8. FIX: Ensure hotel_orders has proper indexes for performance
-- ==========================================================
CREATE INDEX IF NOT EXISTS idx_hotel_orders_table_id ON hotel_orders(table_id);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_session_id ON hotel_orders(session_id);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_waiter_id ON hotel_orders(waiter_id);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_shift_id ON hotel_orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_status ON hotel_orders(status);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_created_at ON hotel_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hotel_order_items_order_id ON hotel_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_hotel_order_items_seat_id ON hotel_order_items(seat_id);
CREATE INDEX IF NOT EXISTS idx_hotel_payments_session_id ON hotel_payments(session_id);
CREATE INDEX IF NOT EXISTS idx_hotel_payments_seat_id ON hotel_payments(seat_id);
CREATE INDEX IF NOT EXISTS idx_hotel_table_sessions_table_id ON hotel_table_sessions(table_id);
CREATE INDEX IF NOT EXISTS idx_hotel_table_session_seats_session_id ON hotel_table_session_seats(session_id);

-- ==========================================================
-- 9. FIX: Add function to safely create orders with validation
-- ==========================================================
CREATE OR REPLACE FUNCTION create_hotel_order(
  p_waiter_id UUID,
  p_table_id UUID DEFAULT NULL,
  p_table_number TEXT DEFAULT NULL,
  p_session_id UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_tax_rate NUMERIC DEFAULT 18,
  p_tax_inclusive BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_order_number TEXT;
  v_subtotal NUMERIC(12,2) := 0;
  v_tax_amount NUMERIC(12,2) := 0;
  v_total_amount NUMERIC(12,2) := 0;
  v_item JSONB;
  v_item_id UUID;
  v_station TEXT;
BEGIN
  -- Generate order ID and number
  v_order_id := gen_random_uuid();
  v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || UPPER(SUBSTRING(MD5(v_order_id::TEXT) FROM 1 FOR 6));
  
  -- Calculate subtotal from items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_subtotal := v_subtotal + COALESCE((v_item->>'unit_price')::NUMERIC * (v_item->>'quantity')::NUMERIC, 0);
  END LOOP;
  
  -- Calculate tax
  IF p_tax_inclusive THEN
    v_total_amount := v_subtotal;
    v_tax_amount := ROUND(v_total_amount * (p_tax_rate / (100 + p_tax_rate)), 2);
  ELSE
    v_tax_amount := ROUND(v_subtotal * (p_tax_rate / 100), 2);
    v_total_amount := v_subtotal + v_tax_amount;
  END IF;
  
  -- Insert the order
  INSERT INTO hotel_orders (
    id, order_number, table_id, table_number, session_id,
    waiter_id, staff_id, shift_id, status,
    kitchen_status, bar_status,
    subtotal, tax_amount, discount_amount, total_amount,
    notes, created_at, updated_at
  ) VALUES (
    v_order_id, v_order_number, p_table_id, p_table_number, p_session_id,
    p_waiter_id, p_waiter_id, p_shift_id, 'pending',
    'pending', 'pending',
    v_subtotal, v_tax_amount, 0, v_total_amount,
    p_notes, NOW(), NOW()
  );
  
  -- Insert items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := gen_random_uuid();
    v_station := COALESCE(v_item->>'station', 'kitchen');
    
    INSERT INTO hotel_order_items (
      id, order_id, service_item_id, name, quantity,
      unit_price, total_price, notes, status,
      station, seat_id, seat_no, payment_group_id,
      shift_id, created_at, updated_at
    ) VALUES (
      v_item_id, v_order_id, v_item->>'service_item_id',
      v_item->>'name',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'unit_price')::NUMERIC,
      (v_item->>'unit_price')::NUMERIC * (v_item->>'quantity')::NUMERIC,
      v_item->>'notes', 'pending',
      v_station,
      (v_item->>'seat_id')::UUID,
      (v_item->>'seat_no')::INTEGER,
      (v_item->>'payment_group_id')::UUID,
      p_shift_id, NOW(), NOW()
    );
  END LOOP;
  
  -- If table is specified, mark it as occupied
  IF p_table_id IS NOT NULL THEN
    UPDATE hotel_tables SET status = 'occupied', updated_at = NOW() WHERE id = p_table_id;
  END IF;
  
  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total_amount', v_total_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================================
-- 10. FIX: Add function to close table session with payment
-- ==========================================================
CREATE OR REPLACE FUNCTION close_table_session(
  p_session_id UUID,
  p_closed_by UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_session RECORD;
  v_result JSONB;
BEGIN
  -- Get session
  SELECT * INTO v_session FROM hotel_table_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;
  
  -- Update session
  UPDATE hotel_table_sessions 
  SET status = 'closed', 
      payment_status = 'paid',
      closed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_session_id;
  
  -- Release table if no other active sessions
  UPDATE hotel_tables 
  SET status = 'cleaning', 
      cleaning_started_at = NOW(),
      updated_at = NOW()
  WHERE id = v_session.table_id 
    AND NOT EXISTS (
      SELECT 1 FROM hotel_table_sessions 
      WHERE table_id = v_session.table_id 
        AND status IN ('active', 'partially_paid')
        AND id != p_session_id
    );
  
  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'table_id', v_session.table_id,
    'table_number', v_session.table_number
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================================
-- 11. FIX: Grant execute permissions on new functions
-- ==========================================================
GRANT EXECUTE ON FUNCTION create_hotel_order TO PUBLIC;
GRANT EXECUTE ON FUNCTION close_table_session TO PUBLIC;
GRANT EXECUTE ON FUNCTION validate_hotel_table_status TO PUBLIC;

COMMIT;